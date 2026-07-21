cmake_minimum_required(VERSION 3.21)

project(native_gb_tetris_browser LANGUAGES C CXX)

if(NOT EMSCRIPTEN)
    message(FATAL_ERROR "Configure this target through emcmake.")
endif()

set(TETRIS_SOURCE_DIR "${CMAKE_CURRENT_LIST_DIR}/../../../native-gb-tetris-modern"
    CACHE PATH "native-gb-tetris-modern source tree")
set(BUILD_TESTING OFF CACHE BOOL "" FORCE)
set(TETRIS_BUILD_EXECUTABLE ON CACHE BOOL "" FORCE)
set(TETRIS_STRICT ON CACHE BOOL "" FORCE)
set(TETRIS_WARN_AS_ERROR ON CACHE BOOL "" FORCE)
set(GUB_WARN_AS_ERROR OFF CACHE BOOL "" FORCE)
set(GUB_RUNTIME_PROJECT_SOURCE_DIR "/native-gb/gubsy-source" CACHE STRING "" FORCE)
set(SDLTTF_HARFBUZZ OFF CACHE BOOL "" FORCE)
set(TETRIS_RUNTIME_PROJECT_ROOT "/native-gb/tetris" CACHE STRING "" FORCE)
set(TETRIS_RUNTIME_ENGINE_ASSETS_ROOT "/native-gb/gubsy-assets" CACHE STRING "" FORCE)
add_compile_options(
    "-ffile-prefix-map=${CMAKE_BINARY_DIR}=build"
    "-ffile-prefix-map=${TETRIS_SOURCE_DIR}=tetris")
add_subdirectory("${TETRIS_SOURCE_DIR}" tetris)

add_executable(native-gb-tetris-browser browser_main.cpp)
set_target_properties(native-gb-tetris-browser PROPERTIES
    OUTPUT_NAME "native-gb-tetris"
    SUFFIX ".js")
target_compile_features(native-gb-tetris-browser PRIVATE cxx_std_20)
target_include_directories(native-gb-tetris-browser PRIVATE "${TETRIS_SOURCE_DIR}/src")
target_link_libraries(native-gb-tetris-browser PRIVATE tetris-application)
target_compile_options(native-gb-tetris-browser PRIVATE
    -Wall -Wextra -Wpedantic -Wconversion -Wsign-conversion -Wshadow -Werror)
target_link_options(native-gb-tetris-browser PRIVATE
    "-sMODULARIZE=1"
    "-sEXPORT_ES6=1"
    "-sEXPORT_NAME=createNativeGbTetris"
    "-sENVIRONMENT=web"
    "-sALLOW_MEMORY_GROWTH=1"
    "-sNO_EXIT_RUNTIME=1"
    "-sFILESYSTEM=1"
    "-sFORCE_FILESYSTEM=1"
    "-sMIN_WEBGL_VERSION=2"
    "-sMAX_WEBGL_VERSION=2"
    "-sEXPORTED_FUNCTIONS=['_malloc','_free','_native_gb_start','_native_gb_frame','_native_gb_shutdown','_native_gb_audio_resume','_native_gb_debug_sampled_frames','_native_gb_debug_simulation_steps','_native_gb_debug_presented_frames','_native_gb_debug_active_renderer','_native_gb_debug_requested_renderer','_native_gb_debug_interpolation','_native_gb_debug_render_rate','_native_gb_debug_preset','_native_gb_debug_browser_managed_vsync','_native_gb_debug_ui_state','_native_gb_debug_set_presentation','_native_gb_debug_set_preset','_native_gb_debug_force_gpu_fallback','_native_gb_last_error']"
    "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','FS','HEAPU8']"
    "-lidbfs.js")
