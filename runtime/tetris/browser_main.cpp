#include "application.hpp"
#include "content/rom.hpp"

#include <SDL3/SDL.h>
#include <emscripten/emscripten.h>

#include <cstddef>
#include <cstdint>
#include <memory>
#include <span>
#include <string>
#include <utility>

namespace {

std::unique_ptr<tetris::Application> application;
std::string last_error;

} // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE int native_gb_start(const std::uint8_t* bytes, std::size_t size,
                                         const char* data_root) {
    if (bytes == nullptr || data_root == nullptr) {
        last_error = "the browser supplied an invalid cartridge buffer or storage path";
        return 0;
    }

    tetris::content::Rom rom;
    if (!tetris::content::load_rom(std::span(bytes, size), rom, last_error) ||
        !tetris::content::validate_supported(rom, last_error)) {
        return 0;
    }

    application = std::make_unique<tetris::Application>();
    (void)SDL_SetHint(SDL_HINT_EMSCRIPTEN_CANVAS_SELECTOR, "#game-canvas");
    const tetris::ApplicationConfig config{
        .data_root = data_root,
        .window = {
            .width = 1280,
            .height = 720,
            .utility = false,
            .desktop_placement = false,
            .apply_display_settings = false,
        },
        .host = {
            .suspend_when_window_inactive = false,
            .externally_scheduled_presentation = true,
            .browser_managed_vsync = true,
        },
        .render_limit = 0,
        .open_tools = false,
    };
    if (!tetris::initialize_application(*application, std::move(rom), config, last_error)) {
        application.reset();
        return 0;
    }
    return 1;
}

EMSCRIPTEN_KEEPALIVE int native_gb_frame(double elapsed_seconds) {
    if (!application)
        return 0;
    if (tetris::step_application(*application, elapsed_seconds))
        return 1;
    tetris::shutdown_application(*application);
    application.reset();
    return 0;
}

EMSCRIPTEN_KEEPALIVE void native_gb_shutdown() {
    if (!application)
        return;
    tetris::shutdown_application(*application);
    application.reset();
}

EMSCRIPTEN_KEEPALIVE int native_gb_audio_resume() {
    return application && application->audio.resume() ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE double native_gb_debug_sampled_frames() {
    return application ? static_cast<double>(application->clock.sampled) : 0.0;
}

EMSCRIPTEN_KEEPALIVE double native_gb_debug_simulation_steps() {
    return application ? static_cast<double>(application->clock.stepped) : 0.0;
}

EMSCRIPTEN_KEEPALIVE double native_gb_debug_presented_frames() {
    return application ? static_cast<double>(application->clock.rendered) : 0.0;
}

EMSCRIPTEN_KEEPALIVE int native_gb_debug_active_renderer() {
    return application ? static_cast<int>(application->video.active_backend) : -1;
}

EMSCRIPTEN_KEEPALIVE int native_gb_debug_requested_renderer() {
    return application ? static_cast<int>(application->settings.renderer) : -1;
}

EMSCRIPTEN_KEEPALIVE int native_gb_debug_interpolation() {
    return application && application->settings.motion_interpolation ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE int native_gb_debug_render_rate() {
    return application ? application->clock.render_rate_cap : 0;
}

EMSCRIPTEN_KEEPALIVE int native_gb_debug_preset() {
    return application ? static_cast<int>(application->settings.preset) : -1;
}

EMSCRIPTEN_KEEPALIVE int native_gb_debug_browser_managed_vsync() {
    return application && application->host.browser_managed_vsync ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE int native_gb_debug_ui_state() {
    if (!application)
        return 0;

    int state = 0;
    if (application->debug.visible)
        state |= 1;
    if (application->debug.visible && application->debug.settings_window)
        state |= 2;
    if (application->controls.visible)
        state |= 4;
    if (application->debug.visible && application->debug.display_window)
        state |= 8;
    return state;
}

EMSCRIPTEN_KEEPALIVE int native_gb_debug_set_presentation(int renderer, int interpolation,
                                                           int rate) {
    if (!application || renderer < 0 || renderer > 1 ||
        !tetris::video::valid_render_rate(rate)) {
        return 0;
    }
    application->settings.renderer = static_cast<tetris::video::RenderBackend>(renderer);
    application->settings.motion_interpolation = interpolation != 0;
    application->settings.render_rate_limit = rate;
    application->clock.render_rate_cap = tetris::video::effective_render_rate(
        application->settings.motion_interpolation, rate);
    application->clock.presentation_accumulator = 0.0;
    return 1;
}

EMSCRIPTEN_KEEPALIVE int native_gb_debug_set_preset(int preset) {
    if (!application || preset < 0 || preset > 2)
        return 0;
    tetris::settings::apply_preset(
        application->settings, static_cast<tetris::settings::Preset>(preset));
    return 1;
}

EMSCRIPTEN_KEEPALIVE void native_gb_debug_force_gpu_fallback(int forced) {
    if (application)
        application->video.force_cpu_fallback = forced != 0;
}

EMSCRIPTEN_KEEPALIVE const char* native_gb_last_error() {
    return last_error.c_str();
}

} // extern "C"

int main() {
    return 0;
}
