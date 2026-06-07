#!/usr/bin/env pwsh
# EmbeddedFlow WASM build script (Windows PowerShell)
# Usage: .\build.ps1

$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$OutDir    = Join-Path $ScriptDir "..\media\wasm"
$OutJs     = Join-Path $OutDir "embf_runtime.js"
$LvglSrc   = Join-Path $ScriptDir "lvgl\src"
$RuntimeC  = Join-Path $ScriptDir "embf_runtime.c"
$RspFile   = Join-Path $ScriptDir "build.rsp"

# Activate emsdk
$emsdkBat = "D:\Works\emsdk\emsdk_env.bat"
if (-not (Test-Path $emsdkBat)) {
    Write-Error "emsdk not found at $emsdkBat"; exit 1
}

# Collect LVGL .c files (exclude linux/SDL/windows drivers and optional libs)
$excludePatterns = @(
    "*\drivers\*",
    "*\libs\freetype\*",
    "*\libs\thorvg\*",
    "*\libs\ffmpeg\*",
    "*\libs\libpng\*",
    "*\libs\tjpgd\*"
)
$lvglCFiles = Get-ChildItem -Path $LvglSrc -Recurse -Filter "*.c" | Where-Object {
    $p = $_.FullName
    $skip = $false
    foreach ($pat in $excludePatterns) {
        if ($p -like $pat) { $skip = $true; break }
    }
    -not $skip
} | Select-Object -ExpandProperty FullName

Write-Host "Found $($lvglCFiles.Count) LVGL source files"

# Exported functions
$exports = @(
    "_embf_init","_embf_deinit","_embf_force_redraw","_embf_set_theme","_embf_main_loop","_embf_get_buffer","_embf_clear_screen",
    "_embf_create_screen","_embf_load_screen","_embf_load_screen_anim",
    "_embf_create_label","_embf_label_set_text",
    "_embf_create_button","_embf_button_set_label",
    "_embf_create_slider","_embf_slider_set_range","_embf_slider_set_value",
    "_embf_create_switch","_embf_switch_set_state",
    "_embf_create_bar","_embf_bar_set_range","_embf_bar_set_value",
    "_embf_create_spinner",
    "_embf_create_arc","_embf_arc_set_range","_embf_arc_set_value",
    "_embf_create_checkbox","_embf_checkbox_set_text","_embf_checkbox_set_state",
    "_embf_create_container",
    "_embf_create_dropdown","_embf_dropdown_set_options","_embf_dropdown_set_selected",
    "_embf_create_roller","_embf_roller_set_options","_embf_roller_set_selected",
    "_embf_create_textarea","_embf_textarea_set_text","_embf_textarea_set_placeholder","_embf_textarea_set_one_line",
    "_embf_create_line","_embf_line_set_points",
    "_embf_obj_set_hidden","_embf_obj_get_screen_coords",
    "_embf_obj_set_scroll_dir",
    "_embf_container_set_flex","_embf_container_set_grid",
    "_embf_obj_set_flex_grow","_embf_obj_set_grid_cell","_embf_obj_set_base_dir",
    "_embf_grid_fr","_embf_grid_content","_embf_grid_template_last",
    "_embf_obj_set_style_bg_color","_embf_obj_set_style_bg_color_part","_embf_obj_set_style_text_color",
    "_embf_obj_set_style_font_size",
    "_embf_obj_set_style_border_color","_embf_obj_set_style_text_align",
    "_embf_obj_set_style_border_width","_embf_obj_set_style_radius","_embf_obj_set_style_pad_all",
    "_embf_anim_start",
    "_embf_register_event",
    "_embf_poll_event","_embf_poll_obj_ptr","_embf_poll_code_ptr","_embf_poll_value_ptr",
    "_embf_on_pointer","_embf_on_wheel","_embf_on_key",
    "_malloc","_free"
)
$exportsJson = "[" + (($exports | ForEach-Object { "`"$_`"" }) -join ",") + "]"

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# Build response file (emcc supports @file like clang)
$rspLines = @(
    "-O2",
    "-DLV_CONF_INCLUDE_SIMPLE",
    "-DNDEBUG",
    "-I`"$ScriptDir`"",
    "-I`"$ScriptDir\lvgl`"",
    "-sWASM=1",
    "-sMODULARIZE=1",
    "-sEXPORT_NAME=createEmbfRuntime",
    "-sEXPORTED_FUNCTIONS=$exportsJson",
    "-sEXPORTED_RUNTIME_METHODS=[`"stringToNewUTF8`",`"HEAPU8`",`"HEAP32`",`"HEAPU32`"]",
    "-sALLOW_MEMORY_GROWTH=1",
    "-sINITIAL_MEMORY=33554432",
    "-sENVIRONMENT=web",
    "--no-entry",
    "-o `"$OutJs`"",
    "`"$RuntimeC`""
)
$latinFontFiles = Get-ChildItem -Path $ScriptDir -Filter "embf_font_latin1_*.c" | Select-Object -ExpandProperty FullName
$rspLines += $latinFontFiles | ForEach-Object { "`"$_`"" }
$rspLines += $lvglCFiles | ForEach-Object { "`"$_`"" }
$rspLines | Set-Content -Path $RspFile -Encoding UTF8

Write-Host "Building embf_runtime.wasm  (first build ~2-5 min) ..."
$buildCmd = "call `"$emsdkBat`" > nul 2>&1 && emcc @`"$RspFile`""
$result = cmd /c $buildCmd 2>&1
# Print warnings/errors
$result | Where-Object { $_ -match "error:" } | Select-Object -First 40 | ForEach-Object { Write-Host $_ }

# Check success by file existence, not exit code (Emscripten sometimes exits 0 even with stderr output)
if (-not (Test-Path $OutJs)) {
    Write-Host ""
    Write-Host "--- Full output ---"
    $result | Select-Object -Last 30 | ForEach-Object { Write-Host $_ }
    Write-Error "Build failed - output file not found: $OutJs"
    exit 1
}

Write-Host ""
Write-Host "SUCCESS"
$jsSize   = (Get-Item $OutJs).Length / 1KB
$wasmFile = $OutJs -replace '\.js$','.wasm'
$wasmSize = (Get-Item $wasmFile).Length / 1KB
Write-Host ("  embf_runtime.js   {0:N0} KB" -f $jsSize)
Write-Host ("  embf_runtime.wasm {0:N0} KB" -f $wasmSize)
