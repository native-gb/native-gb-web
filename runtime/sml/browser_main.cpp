#include "audio/output.hpp"
#include "content/catalog.hpp"
#include "content/game_resources.hpp"
#include "content/rom.hpp"
#include "controls_menu.hpp"
#include "debug_menu.hpp"
#include "frame.hpp"
#include "game/replay.hpp"
#include "game/state.hpp"
#include "settings.hpp"
#include "src/imgui_layer.hpp"
#include "storage/campaign.hpp"
#include "video/frame.hpp"
#include "video/output.hpp"
#include "window.hpp"

#include <SDL3/SDL.h>
#include <emscripten/emscripten.h>
#include <gubsy/runtime.hpp>

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <cmath>
#include <optional>
#include <span>
#include <string>

namespace {

// Browser ownership deliberately mirrors desktop main: every runtime domain is
// visible here and the frame remains input, fixed simulation, then presentation.
sml::content::Catalog content;
sml::GameState game;
GubsyRuntime runtime;
GubsyFrame host_frame;
sml::settings::Settings settings;
sml::settings::Settings saved_settings;
sml::storage::CampaignProgress saved_progress;
sml::FrameClock frame_clock;
sml::FrameInput input;
sml::ControlsMenu controls;
sml::Replay replay;
sml::video::MotionHistory motion;
sml::DebugUi debug;
sml::audio::Output audio;
sml::video::Output output;

std::filesystem::path settings_path;
std::filesystem::path campaign_path;
std::string settings_error;
std::string campaign_error;
std::string last_error;
std::uint64_t sampled_frames{};
std::uint64_t simulation_steps{};
std::uint64_t presented_frames{};
double presentation_accumulator{};
bool settings_writable{};
bool campaign_writable{};
bool settings_autosave_failed{};
bool campaign_autosave_failed{};
bool window_initialized{};
bool started{};

void persist_domains() {
    if (!started)
        return;
    settings.rules = game.rules;
    settings.fullscreen =
        host_frame.window != nullptr &&
        (SDL_GetWindowFlags(host_frame.window) & SDL_WINDOW_FULLSCREEN) != 0;
    if (settings_writable && settings != saved_settings &&
        sml::settings::save(settings_path, settings, settings_error)) {
        saved_settings = settings;
    }
    sml::storage::CampaignProgress progress{
        .top_score = game.session.top_score,
        .wins = game.session.wins,
    };
    if (campaign_writable && progress != saved_progress &&
        sml::storage::merge_and_save_campaign(campaign_path, progress, campaign_error)) {
        saved_progress = progress;
    }
}

void shutdown_domains() {
    persist_domains();
    sml::video::shutdown_output(output);
    audio.shutdown();
    if (window_initialized)
        sml::shutdown_window(runtime);
    output = {};
    host_frame = {};
    frame_clock = {};
    input = {};
    controls = {};
    replay = {};
    motion = {};
    debug = {};
    game = {};
    content = {};
    window_initialized = false;
    started = false;
}

void apply_replay_request() {
    const sml::ReplayIdentity identity{
        .rom_sha1 = content.rom_sha1,
        .rules = game.rules,
    };
    if (debug.replay_request == sml::ReplayRequest::record) {
        sml::begin_recording(replay, game, identity);
    } else if (debug.replay_request == sml::ReplayRequest::stop) {
        sml::stop_replay(replay);
    } else if (debug.replay_request == sml::ReplayRequest::play) {
        if (!sml::rewind_replay(replay, game, identity)) {
            gubsy_add_alert(runtime, "Replay identity does not match current ROM/rules");
        } else {
            motion.valid = false;
        }
    } else if (debug.replay_request == sml::ReplayRequest::clear) {
        sml::clear_replay(replay);
    }
    debug.replay_request = sml::ReplayRequest::none;
}

void apply_setup_request() {
    if (!debug.setup_requested)
        return;
    const bool setup_applied = sml::apply_state_setup(game, debug.setup);
    const bool pipe_applied =
        !debug.pipe_route_requested ||
        (setup_applied &&
         sml::begin_pipe_route(game, static_cast<std::size_t>(debug.pipe_route)));
    if (setup_applied && pipe_applied) {
        sml::clear_replay(replay);
        audio.reset();
        sml::clear_buttons(input.game);
        debug.paused = false;
        motion.valid = false;
    } else {
        gubsy_add_alert(runtime, debug.pipe_route_requested
                                     ? "Pipe route is not valid for this level"
                                     : "State setup is not valid for this campaign");
    }
    debug.setup_requested = false;
    debug.pipe_route_requested = false;
}

void autosave() {
    settings.rules = game.rules;
    settings.fullscreen =
        host_frame.window != nullptr &&
        (SDL_GetWindowFlags(host_frame.window) & SDL_WINDOW_FULLSCREEN) != 0;
    if (settings_writable && !settings_autosave_failed && settings != saved_settings) {
        if (sml::settings::save(settings_path, settings, settings_error)) {
            saved_settings = settings;
        } else {
            settings_autosave_failed = true;
        }
    }

    sml::storage::CampaignProgress progress{
        .top_score = game.session.top_score,
        .wins = game.session.wins,
    };
    if (campaign_writable && !campaign_autosave_failed && progress != saved_progress) {
        if (sml::storage::merge_and_save_campaign(campaign_path, progress, campaign_error)) {
            saved_progress = progress;
            game.session.top_score = progress.top_score;
            game.session.wins = progress.wins;
        } else {
            campaign_autosave_failed = true;
        }
    }
}

bool run_frame(double elapsed_seconds) {
    // The browser compositor owns presentation cadence and vsync. Only the
    // deterministic accumulator crosses this externally scheduled boundary.
    frame_clock.frame_started = SDL_GetTicksNS();
    frame_clock.elapsed = std::clamp(elapsed_seconds, 0.0, 0.25);
    frame_clock.accumulator += frame_clock.elapsed;

    bool active = true;
    const sml::WindowInput window_input =
        sml::poll_window_events(runtime, host_frame, active, false);
    if (window_input.toggle_deployed_tools)
        sml::toggle_tool_layout(debug, controls, sml::ToolLayout::deployed);
    if (window_input.toggle_tester_tools)
        sml::toggle_tool_layout(debug, controls, sml::ToolLayout::tester);
    if (window_input.gamepad_changed)
        sml::refresh_controls_navigation(controls);
    sml::sync_controls_navigation(controls);
    if (window_input.quit)
        return false;

    imgui_new_frame();
    if (!sml::sample_host_input(runtime, controls, input))
        return false;
    ++sampled_frames;
    sml::sync_controls_navigation(controls);
    if (window_input.zoom_steps != 0 && game.rules.view != sml::ViewLayout::original_frame) {
        const float zoom =
            game.rules.zoom + static_cast<float>(window_input.zoom_steps) * 0.25F;
        if (sml::valid_zoom(zoom))
            game.rules.zoom = zoom;
    }
    if (game.rules.view == sml::ViewLayout::free_debug &&
        (window_input.pan_x != 0.0F || window_input.pan_y != 0.0F)) {
        sml::pan_camera(game.camera, -window_input.pan_x / game.camera.zoom,
                        -window_input.pan_y / game.camera.zoom,
                        sml::world_width(game.world));
    }

    apply_replay_request();
    apply_setup_request();

    while (sml::step_due(frame_clock)) {
        if (debug.paused && !debug.step)
            continue;
        sml::StepInput step_input;
        if (replay.playing) {
            const std::optional<sml::StepInput> recorded = sml::next_replay_input(replay);
            if (!recorded)
                continue;
            step_input = *recorded;
        } else {
            step_input = sml::consume_buttons(input.game);
        }
        sml::append_replay_input(replay, step_input);
        sml::video::capture_motion(motion, game);
        sml::step_game(game, step_input);
        audio.step(game, game.frame_cadence);
        debug.step = false;
        ++simulation_steps;
    }

    // RAF may arrive faster than the selected presentation ceiling. Input and
    // simulation still run on every callback; only composition is skipped.
    const int presentation_rate = sml::video::effective_render_rate(
        settings.motion_interpolation, settings.render_rate_limit);
    frame_clock.render_rate_cap = presentation_rate;
    presentation_accumulator +=
        frame_clock.elapsed * static_cast<double>(std::max(presentation_rate, 1));
    if (presentation_accumulator + 1.0e-9 < 1.0) {
        autosave();
        return true;
    }
    if (presentation_accumulator < 1.0) {
        presentation_accumulator = 0.0;
    } else {
        presentation_accumulator -= std::floor(presentation_accumulator);
    }

    gubsy_update_runtime(runtime, static_cast<float>(frame_clock.elapsed));
    host_frame = gubsy_get_frame(runtime);
    sml::configure_camera(game.camera, game.rules, host_frame.render_width,
                          host_frame.render_height);
    const bool interpolate = !debug.paused && settings.motion_interpolation;
    const float alpha = interpolate ? sml::interpolation_alpha(frame_clock) : 1.0F;
    const sml::video::MotionHistory no_motion;
    const sml::video::MotionHistory& render_motion = interpolate ? motion : no_motion;
    const sml::video::RenderFrame render =
        sml::video::compose_frame(game, content, render_motion, alpha);
    if (!sml::video::draw_output(output, host_frame.renderer, host_frame.render_target, render,
                                 content, settings.renderer) ||
        !gubsy_draw_frame_to_window(runtime)) {
        last_error = std::string("could not render browser frame: ") + SDL_GetError();
        return false;
    }

    (void)sml::draw_debug_ui(debug, controls, game, settings, content, audio, replay,
                             render.layout, output.active_backend);
    sml::draw_controls(controls, runtime, settings, debug);
    frame_clock.render_rate_cap = sml::video::effective_render_rate(
        settings.motion_interpolation, settings.render_rate_limit);
    sml::apply_window_request(host_frame.window, debug.display_request);
    debug.display_request = sml::DisplayRequest::none;
    imgui_render_layer();
    gubsy_present_frame(runtime);
    ++frame_clock.rendered;
    ++presented_frames;
    autosave();
    return true;
}

int ui_state() {
    int state = 0;
    if (debug.visible)
        state |= 1;
    if (debug.visible && debug.settings_window)
        state |= 2;
    if (controls.visible)
        state |= 4;
    if (debug.visible && debug.display_window)
        state |= 8;
    return state;
}

} // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE int native_gb_start(const std::uint8_t* bytes, std::size_t size,
                                         const char* data_root) {
    if (bytes == nullptr || data_root == nullptr) {
        last_error = "the browser supplied an invalid cartridge buffer or storage path";
        return 0;
    }
    shutdown_domains();
    last_error.clear();

    sml::content::Rom rom;
    if (!sml::content::load_rom(std::span(bytes, size), rom, last_error) ||
        !sml::content::extract_catalog(rom, content, last_error)) {
        return 0;
    }

    const std::filesystem::path root(data_root);
    settings_path = root / "settings.cfg";
    campaign_path = root / "campaign.cfg";
    settings = sml::settings::enhanced_settings();
    settings_writable = sml::settings::load(settings_path, settings, settings_error);
    saved_settings = settings;
    sml::storage::CampaignProgress progress;
    campaign_writable =
        sml::storage::load_campaign(campaign_path, progress, campaign_error);
    saved_progress = progress;
    settings_autosave_failed = false;
    campaign_autosave_failed = false;

    sml::start_game(game, sml::content::make_game_resources(content), settings.rules);
    game.session.top_score = progress.top_score;
    game.session.wins = progress.wins;
    game.session.expert_mode = progress.wins != 0;

    (void)SDL_SetHint(SDL_HINT_EMSCRIPTEN_CANVAS_SELECTOR, "#game-canvas");
    const sml::WindowConfig window_config{
        .width = 1280,
        .height = 720,
        .fullscreen = false,
        .utility = false,
        .desktop_placement = false,
        .apply_display_settings = false,
        .control_profile = settings.control_profile,
    };
    if (!sml::initialize_window(runtime, host_frame, root, window_config)) {
        last_error = std::string("could not initialize browser window: ") + SDL_GetError();
        shutdown_domains();
        return 0;
    }
    window_initialized = true;

    frame_clock.render_rate_cap = sml::video::effective_render_rate(
        settings.motion_interpolation, settings.render_rate_limit);
    if (!audio.initialize(content.audio))
        SDL_ClearError();
    audio.set_volume(settings.music_volume, settings.effects_volume);
    sampled_frames = 0;
    simulation_steps = 0;
    presented_frames = 0;
    presentation_accumulator = 0.0;
    started = true;
    return 1;
}

EMSCRIPTEN_KEEPALIVE int native_gb_frame(double elapsed_seconds) {
    if (!started)
        return 0;
    if (run_frame(elapsed_seconds))
        return 1;
    shutdown_domains();
    return 0;
}

EMSCRIPTEN_KEEPALIVE void native_gb_shutdown() {
    shutdown_domains();
}

EMSCRIPTEN_KEEPALIVE int native_gb_audio_resume() {
    return started && audio.resume() ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE double native_gb_debug_sampled_frames() {
    return static_cast<double>(sampled_frames);
}

EMSCRIPTEN_KEEPALIVE double native_gb_debug_simulation_steps() {
    return static_cast<double>(simulation_steps);
}

EMSCRIPTEN_KEEPALIVE double native_gb_debug_presented_frames() {
    return static_cast<double>(presented_frames);
}

EMSCRIPTEN_KEEPALIVE int native_gb_debug_active_renderer() {
    return started ? static_cast<int>(output.active_backend) : -1;
}

EMSCRIPTEN_KEEPALIVE int native_gb_debug_requested_renderer() {
    return started ? static_cast<int>(settings.renderer) : -1;
}

EMSCRIPTEN_KEEPALIVE int native_gb_debug_interpolation() {
    return started && settings.motion_interpolation ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE int native_gb_debug_render_rate() {
    return started ? frame_clock.render_rate_cap : 0;
}

EMSCRIPTEN_KEEPALIVE int native_gb_debug_behavior() {
    return started ? static_cast<int>(settings.rules.behavior) : -1;
}

EMSCRIPTEN_KEEPALIVE int native_gb_debug_phase() {
    return started ? static_cast<int>(game.phase) : -1;
}

EMSCRIPTEN_KEEPALIVE int native_gb_debug_browser_managed_vsync() {
    return started ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE int native_gb_debug_ui_state() {
    return started ? ui_state() : 0;
}

EMSCRIPTEN_KEEPALIVE int native_gb_debug_set_presentation(int renderer, int interpolation,
                                                          int rate) {
    if (!started || renderer < 0 || renderer > 1 || !sml::video::valid_render_rate(rate))
        return 0;
    settings.renderer = static_cast<sml::video::RenderBackend>(renderer);
    settings.motion_interpolation = interpolation != 0;
    settings.render_rate_limit = rate;
    frame_clock.render_rate_cap = sml::video::effective_render_rate(
        settings.motion_interpolation, settings.render_rate_limit);
    presentation_accumulator = 0.0;
    return 1;
}

EMSCRIPTEN_KEEPALIVE int native_gb_debug_set_behavior(int behavior) {
    if (!started || behavior < 0 || behavior > 1)
        return 0;
    sml::settings::apply_behavior(settings, static_cast<sml::BehaviorPreset>(behavior));
    sml::apply_runtime_rules(game, settings.rules);
    return 1;
}

EMSCRIPTEN_KEEPALIVE void native_gb_debug_force_gpu_fallback(int forced) {
    if (started)
        output.force_cpu_fallback = forced != 0;
}

EMSCRIPTEN_KEEPALIVE const char* native_gb_last_error() {
    return last_error.c_str();
}

} // extern "C"

int main() {
    return 0;
}
