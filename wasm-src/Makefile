# EmbeddedFlow WASM build
#
# Requirements:
#   - Emscripten SDK active in shell:  source D:/Works/emsdk/emsdk_env.sh
#     OR on Windows PowerShell:        D:\Works\emsdk\emsdk_env.ps1
#   - LVGL 9.x source cloned into ./lvgl/
#       git clone --depth 1 --branch v9.5.0 https://github.com/lvgl/lvgl.git lvgl
#
# Usage:
#   make            — build embf_runtime.js + .wasm → ../media/wasm/
#   make clean      — remove build artifacts

EMSDK      ?= D:/Works/emsdk
EMCC       := emcc
OUT_DIR    := ../media/wasm
OUT_JS     := $(OUT_DIR)/embf_runtime.js
OUT_WASM   := $(OUT_DIR)/embf_runtime.wasm

LVGL_SRC   := lvgl/src

# Collect all LVGL C sources recursively
LVGL_C_FILES := $(shell find $(LVGL_SRC) -name "*.c")

# Our runtime
SRC_FILES := embf_runtime.c $(LVGL_C_FILES)

# LVGL config: point to our lv_conf.h
CFLAGS := \
    -O2 \
    -DLV_CONF_INCLUDE_SIMPLE \
    -DLV_USE_LOG=0 \
    -DNDEBUG \
    -I. \
    -Ilvgl

# Emscripten flags
EM_FLAGS := \
    -s WASM=1 \
    -s MODULARIZE=1 \
    -s EXPORT_NAME="createEmbfRuntime" \
    -s EXPORTED_FUNCTIONS="[ \
        '_embf_init', \
        '_embf_main_loop', \
        '_embf_get_buffer', \
        '_embf_clear_screen', \
        '_embf_create_screen', \
        '_embf_load_screen', \
        '_embf_load_screen_anim', \
        '_embf_create_label', \
        '_embf_label_set_text', \
        '_embf_create_button', \
        '_embf_button_set_label', \
        '_embf_create_slider', \
        '_embf_slider_set_range', \
        '_embf_slider_set_value', \
        '_embf_create_switch', \
        '_embf_switch_set_state', \
        '_embf_create_bar', \
        '_embf_bar_set_range', \
        '_embf_bar_set_value', \
        '_embf_create_spinner', \
        '_embf_create_arc', \
        '_embf_arc_set_range', \
        '_embf_arc_set_value', \
        '_embf_create_checkbox', \
        '_embf_checkbox_set_text', \
        '_embf_checkbox_set_state', \
        '_embf_create_container', \
        '_embf_obj_set_style_bg_color', \
        '_embf_obj_set_style_text_color', \
        '_embf_obj_set_style_border_width', \
        '_embf_obj_set_style_radius', \
        '_embf_obj_set_style_pad_all', \
        '_embf_on_pointer', \
        '_embf_on_wheel', \
        '_embf_on_key', \
        '_malloc', \
        '_free' \
    ]" \
    -s EXPORTED_RUNTIME_METHODS="['stringToNewUTF8','HEAPU8']" \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s INITIAL_MEMORY=33554432 \
    -s ENVIRONMENT=web \
    -s SINGLE_FILE=0 \
    --no-entry

.PHONY: all clean lvgl_clone

all: $(OUT_DIR) $(OUT_JS)

$(OUT_DIR):
	mkdir -p $(OUT_DIR)

$(OUT_JS): $(SRC_FILES) lv_conf.h
	$(EMCC) $(CFLAGS) $(EM_FLAGS) $(SRC_FILES) -o $(OUT_JS)
	@echo "Built: $(OUT_JS)"
	@echo "Built: $(OUT_WASM)"

# Clone LVGL source if not already present
lvgl_clone:
	@if [ ! -d "lvgl" ]; then \
		git clone --depth 1 --branch v9.5.0 https://github.com/lvgl/lvgl.git lvgl; \
	else \
		echo "lvgl/ already exists, skipping clone"; \
	fi

clean:
	rm -f $(OUT_JS) $(OUT_WASM)
