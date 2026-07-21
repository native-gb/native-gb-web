cmake_minimum_required(VERSION 3.21)

project(native_gb_sml_browser LANGUAGES C CXX)

if(NOT EMSCRIPTEN)
    message(FATAL_ERROR "Configure this target through emcmake.")
endif()

set(SML_SOURCE_DIR "${CMAKE_CURRENT_LIST_DIR}/../../../native-gb-super-mario-land-modern"
    CACHE PATH "native-gb-super-mario-land-modern source tree")
set(BUILD_TESTING OFF CACHE BOOL "" FORCE)
set(SML_MODERN_BUILD_EXECUTABLE ON CACHE BOOL "" FORCE)
set(SML_MODERN_STRICT ON CACHE BOOL "" FORCE)
set(SML_MODERN_WARN_AS_ERROR ON CACHE BOOL "" FORCE)
set(GUB_WARN_AS_ERROR OFF CACHE BOOL "" FORCE)
set(GUB_RUNTIME_PROJECT_SOURCE_DIR "/native-gb/gubsy-source" CACHE STRING "" FORCE)
set(SDLTTF_HARFBUZZ OFF CACHE BOOL "" FORCE)
set(SML_MODERN_RUNTIME_PROJECT_ROOT "/native-gb/sml-modern" CACHE STRING "" FORCE)
set(SML_MODERN_RUNTIME_ENGINE_ASSETS_ROOT "/native-gb/gubsy-assets" CACHE STRING "" FORCE)
add_compile_options(
    "-ffile-prefix-map=${CMAKE_BINARY_DIR}=build"
    "-ffile-prefix-map=${SML_SOURCE_DIR}=sml-modern")
add_subdirectory("${SML_SOURCE_DIR}" sml-modern)

add_executable(native-gb-sml-browser browser_main.cpp)
set_target_properties(native-gb-sml-browser PROPERTIES
    OUTPUT_NAME "native-gb-sml"
    SUFFIX ".js")
target_compile_features(native-gb-sml-browser PRIVATE cxx_std_20)
target_include_directories(native-gb-sml-browser PRIVATE "${SML_SOURCE_DIR}/src")
target_link_libraries(native-gb-sml-browser PRIVATE
    sml-modern-host sml-modern-content sml-modern-settings sml-modern-storage)
target_compile_options(native-gb-sml-browser PRIVATE
    -Wall -Wextra -Wpedantic -Wconversion -Wsign-conversion -Wshadow -Werror)
target_link_options(native-gb-sml-browser PRIVATE
    "-sMODULARIZE=1"
    "-sEXPORT_ES6=1"
    "-sEXPORT_NAME=createNativeGbSml"
    "-sENVIRONMENT=web"
    "-sALLOW_MEMORY_GROWTH=1"
    "-sINITIAL_MEMORY=67108864"
    "-sSTACK_SIZE=16777216"
    "-sNO_EXIT_RUNTIME=1"
    "-sFILESYSTEM=1"
    "-sFORCE_FILESYSTEM=1"
    "-sMIN_WEBGL_VERSION=2"
    "-sMAX_WEBGL_VERSION=2"
    "-sEXPORTED_FUNCTIONS=['_malloc','_free','_native_gb_start','_native_gb_frame','_native_gb_shutdown','_native_gb_audio_resume','_native_gb_debug_sampled_frames','_native_gb_debug_simulation_steps','_native_gb_debug_presented_frames','_native_gb_debug_active_renderer','_native_gb_debug_requested_renderer','_native_gb_debug_interpolation','_native_gb_debug_render_rate','_native_gb_debug_behavior','_native_gb_debug_phase','_native_gb_debug_browser_managed_vsync','_native_gb_debug_ui_state','_native_gb_debug_set_presentation','_native_gb_debug_set_behavior','_native_gb_debug_force_gpu_fallback','_native_gb_last_error']"
    "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','FS','HEAPU8']"
    "-lidbfs.js")
