/**
 * EmbeddedFlow LVGL WASM Runtime
 *
 * Compiled with Emscripten. Exposes an embf_* C API that the webview JS calls
 * to construct LVGL UI objects from .embf project JSON, tick the renderer, and
 * read back the RGBA framebuffer.
 *
 * Build:  see Makefile in this directory
 * Output: ../media/wasm/embf_runtime.js + embf_runtime.wasm
 */

#include "lvgl/lvgl.h"
#include <stdlib.h>
#include <string.h>
#include <emscripten.h>

/* ── Display buffer ─────────────────────────────────────────────────────── */

static int g_width  = 0;
static int g_height = 0;
static uint8_t *g_framebuffer = NULL; /* RGBA8888, width * height * 4 */

static lv_display_t *g_display = NULL;
static lv_color_t   *g_draw_buf1 = NULL;
static lv_color_t   *g_draw_buf2 = NULL;

/* flush_cb: copy the rendered area into the RGBA framebuffer */
static void flush_cb(lv_display_t *disp, const lv_area_t *area, uint8_t *px_map)
{
    int x1 = area->x1, y1 = area->y1;
    int x2 = area->x2, y2 = area->y2;

    /* px_map is in the format lv_display_get_color_format(disp).
     * We configured LV_COLOR_FORMAT_ARGB8888 so each pixel is 4 bytes: B G R A.
     * We repack to RGBA for the canvas ImageData. */
    for (int y = y1; y <= y2; y++) {
        for (int x = x1; x <= x2; x++) {
            int src_idx = ((y - y1) * (x2 - x1 + 1) + (x - x1)) * 4;
            int dst_idx = (y * g_width + x) * 4;

            uint8_t b = px_map[src_idx + 0];
            uint8_t g = px_map[src_idx + 1];
            uint8_t r = px_map[src_idx + 2];
            uint8_t a = px_map[src_idx + 3];

            g_framebuffer[dst_idx + 0] = r;
            g_framebuffer[dst_idx + 1] = g;
            g_framebuffer[dst_idx + 2] = b;
            g_framebuffer[dst_idx + 3] = a;
        }
    }

    lv_display_flush_ready(disp);
}

/* ── Tick source ────────────────────────────────────────────────────────── */

static uint32_t tick_get_cb(void)
{
    return (uint32_t)emscripten_get_now();
}

/* ── Color helper ───────────────────────────────────────────────────────── */

/* color is packed as ARGB8888 in a uint32: 0xAARRGGBB */
static lv_color_t unpack_color(uint32_t argb)
{
    uint8_t r = (argb >> 16) & 0xFF;
    uint8_t g = (argb >>  8) & 0xFF;
    uint8_t b = (argb >>  0) & 0xFF;
    return lv_color_make(r, g, b);
}

/* ── Public API ─────────────────────────────────────────────────────────── */

/**
 * Initialise LVGL and create the display.
 *
 * @param width         Display width in pixels
 * @param height        Display height in pixels
 * @param dark_theme    1 = dark theme, 0 = light theme
 * @param primary_argb  Primary theme color packed as 0xAARRGGBB (0 = default palette blue)
 * @param secondary_argb Secondary theme color packed as 0xAARRGGBB (0 = default palette cyan)
 */
EMSCRIPTEN_KEEPALIVE
void embf_init(int width, int height, int dark_theme,
               uint32_t primary_argb, uint32_t secondary_argb)
{
    g_width  = width;
    g_height = height;

    /* Allocate RGBA framebuffer */
    if (g_framebuffer) free(g_framebuffer);
    g_framebuffer = (uint8_t *)calloc(width * height * 4, 1);

    /* Init LVGL */
    lv_init();
    lv_tick_set_cb(tick_get_cb);

    /* Create display */
    g_display = lv_display_create(width, height);
    lv_display_set_color_format(g_display, LV_COLOR_FORMAT_ARGB8888);

    /* Partial buffers (low memory); preview clears the RGBA framebuffer each frame. */
    size_t buf_size = (size_t)(width * height / 10) * sizeof(lv_color_t);
    if (buf_size < 4) {
        buf_size = 4;
    }
    if (g_draw_buf1) free(g_draw_buf1);
    if (g_draw_buf2) free(g_draw_buf2);
    g_draw_buf1 = (lv_color_t *)malloc(buf_size);
    g_draw_buf2 = (lv_color_t *)malloc(buf_size);
    if(!g_draw_buf1 || !g_draw_buf2) {
        return;
    }
    lv_display_set_buffers(g_display, g_draw_buf1, g_draw_buf2, buf_size,
                           LV_DISPLAY_RENDER_MODE_PARTIAL);

    lv_display_set_flush_cb(g_display, flush_cb);

    /* Resolve theme colors */
    lv_color_t primary   = primary_argb   ? unpack_color(primary_argb)   : lv_palette_main(LV_PALETTE_BLUE);
    lv_color_t secondary = secondary_argb ? unpack_color(secondary_argb) : lv_palette_main(LV_PALETTE_CYAN);

    /* Apply theme */
    lv_theme_t *theme = lv_theme_default_init(
        g_display, primary, secondary, dark_theme ? true : false, LV_FONT_DEFAULT);
    lv_display_set_theme(g_display, theme);
}

EMSCRIPTEN_KEEPALIVE
void embf_main_loop(void)
{
    /* Only clear during screen-load animation (partial flushes leave stale pixels then).
     * Clearing every frame breaks static UI: nothing stays dirty so nothing redraws. */
    if(g_framebuffer && g_display && lv_display_get_screen_loading(g_display) != NULL) {
        memset(g_framebuffer, 0, (size_t)g_width * g_height * 4);
    }
    lv_timer_handler();
}

EMSCRIPTEN_KEEPALIVE
uint8_t *embf_get_buffer(void)
{
    return g_framebuffer;
}

static void embf_discard_pending_events(void);

EMSCRIPTEN_KEEPALIVE
void embf_clear_screen(void)
{
    embf_discard_pending_events();

    lv_obj_t *scr = lv_screen_active();
    if (scr) lv_obj_clean(scr);
}

/* ── Screen management ──────────────────────────────────────────────────── */

EMSCRIPTEN_KEEPALIVE
lv_obj_t *embf_create_screen(void)
{
    return lv_obj_create(NULL);
}

EMSCRIPTEN_KEEPALIVE
void embf_load_screen(lv_obj_t *screen)
{
    lv_screen_load(screen);
    lv_obj_invalidate(screen);
    embf_discard_pending_events();
}

EMSCRIPTEN_KEEPALIVE
void embf_load_screen_anim(lv_obj_t *screen, int anim_type, uint32_t time, uint32_t delay, int auto_del)
{
    lv_screen_load_anim(screen, (lv_screen_load_anim_t)anim_type, time, delay, auto_del != 0);
    lv_obj_invalidate(screen);
  /* Do NOT call lv_refr_now() — it runs lv_anim_refr_now() and finishes the transition instantly. */
    embf_discard_pending_events();
}

/* ── Object position / size helpers ────────────────────────────────────── */

static void set_pos_size(lv_obj_t *obj, int x, int y, int w, int h)
{
    lv_obj_set_pos(obj, (lv_coord_t)x, (lv_coord_t)y);
    lv_obj_set_size(obj, (lv_coord_t)w, (lv_coord_t)h);
}

/* ── Widget constructors ────────────────────────────────────────────────── */

EMSCRIPTEN_KEEPALIVE
lv_obj_t *embf_create_label(lv_obj_t *parent, int x, int y, int w, int h)
{
    lv_obj_t *obj = lv_label_create(parent);
    set_pos_size(obj, x, y, w, h);
    return obj;
}

EMSCRIPTEN_KEEPALIVE
void embf_label_set_text(lv_obj_t *obj, const char *text)
{
    lv_label_set_text(obj, text);
}

EMSCRIPTEN_KEEPALIVE
lv_obj_t *embf_create_button(lv_obj_t *parent, int x, int y, int w, int h)
{
    lv_obj_t *obj = lv_button_create(parent);
    set_pos_size(obj, x, y, w, h);
    return obj;
}

EMSCRIPTEN_KEEPALIVE
void embf_button_set_label(lv_obj_t *btn, const char *text)
{
    lv_obj_t *lbl = lv_label_create(btn);
    lv_label_set_text(lbl, text);
    lv_obj_center(lbl);
}

EMSCRIPTEN_KEEPALIVE
lv_obj_t *embf_create_slider(lv_obj_t *parent, int x, int y, int w, int h)
{
    lv_obj_t *obj = lv_slider_create(parent);
    set_pos_size(obj, x, y, w, h);
    return obj;
}

EMSCRIPTEN_KEEPALIVE
void embf_slider_set_range(lv_obj_t *obj, int min, int max)
{
    lv_slider_set_range(obj, min, max);
}

EMSCRIPTEN_KEEPALIVE
void embf_slider_set_value(lv_obj_t *obj, int value)
{
    lv_slider_set_value(obj, value, LV_ANIM_OFF);
}

EMSCRIPTEN_KEEPALIVE
lv_obj_t *embf_create_switch(lv_obj_t *parent, int x, int y, int w, int h)
{
    lv_obj_t *obj = lv_switch_create(parent);
    set_pos_size(obj, x, y, w, h);
    return obj;
}

EMSCRIPTEN_KEEPALIVE
void embf_switch_set_state(lv_obj_t *obj, int checked)
{
    if (checked) {
        lv_obj_add_state(obj, LV_STATE_CHECKED);
    } else {
        lv_obj_remove_state(obj, LV_STATE_CHECKED);
    }
}

EMSCRIPTEN_KEEPALIVE
lv_obj_t *embf_create_bar(lv_obj_t *parent, int x, int y, int w, int h)
{
    lv_obj_t *obj = lv_bar_create(parent);
    set_pos_size(obj, x, y, w, h);
    return obj;
}

EMSCRIPTEN_KEEPALIVE
void embf_bar_set_range(lv_obj_t *obj, int min, int max)
{
    lv_bar_set_range(obj, min, max);
}

EMSCRIPTEN_KEEPALIVE
void embf_bar_set_value(lv_obj_t *obj, int value)
{
    lv_bar_set_value(obj, value, LV_ANIM_OFF);
}

EMSCRIPTEN_KEEPALIVE
lv_obj_t *embf_create_spinner(lv_obj_t *parent, int x, int y, int w, int h,
                               uint32_t speed_ms, uint32_t arc_length_deg)
{
    lv_obj_t *obj = lv_spinner_create(parent);
    set_pos_size(obj, x, y, w, h);
    lv_spinner_set_anim_params(obj, speed_ms, arc_length_deg);
    return obj;
}

EMSCRIPTEN_KEEPALIVE
lv_obj_t *embf_create_arc(lv_obj_t *parent, int x, int y, int w, int h)
{
    lv_obj_t *obj = lv_arc_create(parent);
    set_pos_size(obj, x, y, w, h);
    return obj;
}

EMSCRIPTEN_KEEPALIVE
void embf_arc_set_range(lv_obj_t *obj, int min, int max)
{
    lv_arc_set_range(obj, min, max);
}

EMSCRIPTEN_KEEPALIVE
void embf_arc_set_value(lv_obj_t *obj, int value)
{
    lv_arc_set_value(obj, value);
}

EMSCRIPTEN_KEEPALIVE
lv_obj_t *embf_create_checkbox(lv_obj_t *parent, int x, int y, int w, int h)
{
    lv_obj_t *obj = lv_checkbox_create(parent);
    set_pos_size(obj, x, y, w, h);
    return obj;
}

EMSCRIPTEN_KEEPALIVE
void embf_checkbox_set_text(lv_obj_t *obj, const char *text)
{
    lv_checkbox_set_text(obj, text);
}

EMSCRIPTEN_KEEPALIVE
void embf_checkbox_set_state(lv_obj_t *obj, int checked)
{
    if (checked) {
        lv_obj_add_state(obj, LV_STATE_CHECKED);
    } else {
        lv_obj_remove_state(obj, LV_STATE_CHECKED);
    }
}

EMSCRIPTEN_KEEPALIVE
lv_obj_t *embf_create_container(lv_obj_t *parent, int x, int y, int w, int h)
{
    lv_obj_t *obj = lv_obj_create(parent);
    set_pos_size(obj, x, y, w, h);
    /* Defaults on `lv_obj` are padded + scrollable; EmbeddedFlow `.embf` coords are measured
     * as full-box positions (matching the design overlay). Without this, grouped widgets sit
     * offset inside the content area and scrollbars appear when union height/width fills the box. */
    lv_obj_set_style_pad_all(obj, 0, LV_PART_MAIN);
    lv_obj_set_style_border_width(obj, 0, LV_PART_MAIN);
    lv_obj_remove_flag(obj, LV_OBJ_FLAG_SCROLLABLE);
    /* Grouping container: no fill in preview (children provide visuals). */
    lv_obj_set_style_bg_opa(obj, LV_OPA_TRANSP, LV_PART_MAIN);
    /* Let slider knobs, switch thumbs, etc. draw outside the union box (see combine padding). */
    lv_obj_add_flag(obj, LV_OBJ_FLAG_OVERFLOW_VISIBLE);
    return obj;
}

EMSCRIPTEN_KEEPALIVE
lv_obj_t *embf_create_dropdown(lv_obj_t *parent, int x, int y, int w, int h)
{
    lv_obj_t *obj = lv_dropdown_create(parent);
    set_pos_size(obj, x, y, w, h);
    return obj;
}

EMSCRIPTEN_KEEPALIVE
void embf_dropdown_set_options(lv_obj_t *obj, const char *options)
{
    lv_dropdown_set_options(obj, options);
}

EMSCRIPTEN_KEEPALIVE
void embf_dropdown_set_selected(lv_obj_t *obj, int index)
{
    lv_dropdown_set_selected(obj, (uint32_t)index);
}

EMSCRIPTEN_KEEPALIVE
lv_obj_t *embf_create_roller(lv_obj_t *parent, int x, int y, int w, int h)
{
    lv_obj_t *obj = lv_roller_create(parent);
    set_pos_size(obj, x, y, w, h);
    return obj;
}

EMSCRIPTEN_KEEPALIVE
void embf_roller_set_options(lv_obj_t *obj, const char *options, int infinite)
{
    lv_roller_set_options(obj, options, infinite ? LV_ROLLER_MODE_INFINITE : LV_ROLLER_MODE_NORMAL);
}

EMSCRIPTEN_KEEPALIVE
void embf_roller_set_selected(lv_obj_t *obj, int index)
{
    lv_roller_set_selected(obj, (uint32_t)index, LV_ANIM_OFF);
}

EMSCRIPTEN_KEEPALIVE
lv_obj_t *embf_create_textarea(lv_obj_t *parent, int x, int y, int w, int h)
{
    lv_obj_t *obj = lv_textarea_create(parent);
    set_pos_size(obj, x, y, w, h);
    return obj;
}

EMSCRIPTEN_KEEPALIVE
void embf_textarea_set_text(lv_obj_t *obj, const char *text)
{
    lv_textarea_set_text(obj, text);
}

EMSCRIPTEN_KEEPALIVE
void embf_textarea_set_placeholder(lv_obj_t *obj, const char *text)
{
    lv_textarea_set_placeholder_text(obj, text);
}

EMSCRIPTEN_KEEPALIVE
void embf_textarea_set_one_line(lv_obj_t *obj, int one_line)
{
    lv_textarea_set_one_line(obj, one_line ? true : false);
}

EMSCRIPTEN_KEEPALIVE
lv_obj_t *embf_create_line(lv_obj_t *parent, int x, int y, int w, int h)
{
    lv_obj_t *obj = lv_line_create(parent);
    set_pos_size(obj, x, y, w, h);
    return obj;
}

/**
 * Set line points from a flat int32 array: [x0, y0, x1, y1, ..., xn, yn].
 * Internally allocates a persistent lv_point_precise_t array (never freed,
 * acceptable for the preview's bounded lifetime).
 */
EMSCRIPTEN_KEEPALIVE
void embf_line_set_points(lv_obj_t *obj, const int *xy, int count)
{
    if (count <= 0) return;
    lv_point_precise_t *pts = (lv_point_precise_t *)malloc((size_t)count * sizeof(lv_point_precise_t));
    if (!pts) return;
    for (int i = 0; i < count; i++) {
        pts[i].x = (lv_value_precise_t)xy[i * 2];
        pts[i].y = (lv_value_precise_t)xy[i * 2 + 1];
    }
    lv_line_set_points(obj, pts, (uint32_t)count);
    /* pts intentionally not freed: LVGL holds this pointer until the object is deleted */
}

/* ── Style setters ──────────────────────────────────────────────────────── */

EMSCRIPTEN_KEEPALIVE
void embf_obj_set_style_bg_color(lv_obj_t *obj, uint32_t argb)
{
    lv_obj_set_style_bg_color(obj, unpack_color(argb), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(obj, LV_OPA_COVER, LV_PART_MAIN);
}

/**
 * Set background color on an arbitrary part (e.g. LV_PART_INDICATOR = 0x020000 for bar/slider fill).
 * @param part_selector  lv_style_selector_t (LV_PART_* often OR'd with LV_STATE_DEFAULT).
 */
EMSCRIPTEN_KEEPALIVE
void embf_obj_set_style_bg_color_part(lv_obj_t *obj, uint32_t part_selector, uint32_t argb)
{
    lv_style_selector_t sel = (lv_style_selector_t)part_selector;
    lv_obj_set_style_bg_color(obj, unpack_color(argb), sel);
    lv_obj_set_style_bg_opa(obj, LV_OPA_COVER, sel);
}

EMSCRIPTEN_KEEPALIVE
void embf_obj_set_style_text_color(lv_obj_t *obj, uint32_t argb)
{
    lv_obj_set_style_text_color(obj, unpack_color(argb), LV_PART_MAIN);
}

EMSCRIPTEN_KEEPALIVE
void embf_obj_set_style_border_width(lv_obj_t *obj, int width)
{
    lv_obj_set_style_border_width(obj, (lv_coord_t)width, LV_PART_MAIN);
}

EMSCRIPTEN_KEEPALIVE
void embf_obj_set_style_radius(lv_obj_t *obj, int radius)
{
    lv_obj_set_style_radius(obj, (lv_coord_t)radius, LV_PART_MAIN);
}

EMSCRIPTEN_KEEPALIVE
void embf_obj_set_style_pad_all(lv_obj_t *obj, int pad)
{
    lv_obj_set_style_pad_all(obj, (lv_coord_t)pad, LV_PART_MAIN);
}

/* Map an integer pixel size to the nearest compiled-in Montserrat variant.
 * Enabled sizes (lv_conf.h): 12 14 16 18 20 24 32 48            */
static const lv_font_t *font_by_size(int size)
{
    if (size <=  12) return &lv_font_montserrat_12;
    if (size <=  15) return &lv_font_montserrat_14;
    if (size <=  17) return &lv_font_montserrat_16;
    if (size <=  19) return &lv_font_montserrat_18;
    if (size <=  22) return &lv_font_montserrat_20;
    if (size <=  28) return &lv_font_montserrat_24;
    if (size <=  40) return &lv_font_montserrat_32;
    return &lv_font_montserrat_48;
}

EMSCRIPTEN_KEEPALIVE
void embf_obj_set_hidden(lv_obj_t *obj, int hidden)
{
    if (hidden) {
        lv_obj_add_flag(obj, LV_OBJ_FLAG_HIDDEN);
    } else {
        lv_obj_remove_flag(obj, LV_OBJ_FLAG_HIDDEN);
    }
}

/** Absolute on-screen bounds in `out_xywh[4]` = { x, y, w, h } (preview HTML overlays). */
EMSCRIPTEN_KEEPALIVE
void embf_obj_get_screen_coords(lv_obj_t *obj, int *out_xywh)
{
    if (!obj || !out_xywh) {
        return;
    }
    lv_area_t area;
    lv_obj_get_coords(obj, &area);
    out_xywh[0] = (int)area.x1;
    out_xywh[1] = (int)area.y1;
    out_xywh[2] = (int)lv_area_get_width(&area);
    out_xywh[3] = (int)lv_area_get_height(&area);
}

EMSCRIPTEN_KEEPALIVE
void embf_obj_set_style_font_size(lv_obj_t *obj, int size)
{
    lv_obj_set_style_text_font(obj, font_by_size(size), LV_PART_MAIN);
}

EMSCRIPTEN_KEEPALIVE
void embf_obj_set_style_border_color(lv_obj_t *obj, uint32_t argb)
{
    lv_obj_set_style_border_color(obj, unpack_color(argb), LV_PART_MAIN);
}

EMSCRIPTEN_KEEPALIVE
void embf_obj_set_style_text_align(lv_obj_t *obj, int align)
{
    /* align: 0=left, 1=center, 2=right */
    lv_text_align_t a = align == 1 ? LV_TEXT_ALIGN_CENTER
                      : align == 2 ? LV_TEXT_ALIGN_RIGHT
                      :              LV_TEXT_ALIGN_LEFT;
    lv_obj_set_style_text_align(obj, a, LV_PART_MAIN);
}

/**
 * Re-apply the LVGL default theme without reinitialising the display.
 * Call this whenever dark-mode or palette colors change at runtime.
 */
EMSCRIPTEN_KEEPALIVE
void embf_set_theme(int dark_theme, uint32_t primary_argb, uint32_t secondary_argb)
{
    if (!g_display) return;

    lv_color_t primary   = primary_argb   ? unpack_color(primary_argb)   : lv_palette_main(LV_PALETTE_BLUE);
    lv_color_t secondary = secondary_argb ? unpack_color(secondary_argb) : lv_palette_main(LV_PALETTE_CYAN);

    lv_theme_t *theme = lv_theme_default_init(
        g_display, primary, secondary, dark_theme ? true : false, LV_FONT_DEFAULT);
    lv_display_set_theme(g_display, theme);

    /* Propagate the style change to every existing object */
    lv_obj_report_style_change(NULL);
}

/* ── Event queue ────────────────────────────────────────────────────────── */

#define EMBF_EVENT_QUEUE_SIZE 32

typedef struct {
    lv_obj_t *obj;
    uint32_t  code;
    int32_t   value;
} EmbfQueuedEvent;

static EmbfQueuedEvent g_evt_queue[EMBF_EVENT_QUEUE_SIZE];
static int g_evt_head = 0;
static int g_evt_tail = 0;

static void embf_discard_pending_events(void)
{
    g_evt_head = 0;
    g_evt_tail = 0;
}

static void generic_event_cb(lv_event_t *e)
{
    lv_obj_t        *obj  = lv_event_get_target_obj(e);
    lv_event_code_t  code = lv_event_get_code(e);

    int32_t value = 0;
    if (code == LV_EVENT_VALUE_CHANGED) {
        if (lv_obj_check_type(obj, &lv_slider_class)) {
            value = (int32_t)lv_slider_get_value(obj);
        }
        else if (lv_obj_check_type(obj, &lv_bar_class)) {
            value = (int32_t)lv_bar_get_value(obj);
        }
        else if (lv_obj_check_type(obj, &lv_arc_class)) {
            value = (int32_t)lv_arc_get_value(obj);
        }
        else if (lv_obj_check_type(obj, &lv_switch_class)) {
            value = lv_obj_has_state(obj, LV_STATE_CHECKED) ? 1 : 0;
        }
        else if (lv_obj_check_type(obj, &lv_checkbox_class)) {
            value = lv_obj_has_state(obj, LV_STATE_CHECKED) ? 1 : 0;
        }
    }

    int next = (g_evt_tail + 1) % EMBF_EVENT_QUEUE_SIZE;
    if (next != g_evt_head) { /* queue not full */
        g_evt_queue[g_evt_tail].obj   = obj;
        g_evt_queue[g_evt_tail].code  = (uint32_t)code;
        g_evt_queue[g_evt_tail].value = value;
        g_evt_tail = next;
    }
}

/* Static poll-result slots — JS reads these after embf_poll_event() returns 1 */
static lv_obj_t *g_poll_obj   = NULL;
static uint32_t  g_poll_code  = 0;
static int32_t   g_poll_value = 0;

EMSCRIPTEN_KEEPALIVE
void embf_register_event(lv_obj_t *obj, uint32_t event_code)
{
    lv_obj_add_event_cb(obj, generic_event_cb, (lv_event_code_t)event_code, NULL);
}

EMSCRIPTEN_KEEPALIVE
int embf_poll_event(void)
{
    if (g_evt_head == g_evt_tail) return 0; /* empty */
    g_poll_obj   = g_evt_queue[g_evt_head].obj;
    g_poll_code  = g_evt_queue[g_evt_head].code;
    g_poll_value = g_evt_queue[g_evt_head].value;
    g_evt_head   = (g_evt_head + 1) % EMBF_EVENT_QUEUE_SIZE;
    return 1;
}

/* Accessors — return pointer into WASM linear memory so JS can read via HEAPU32/HEAP32 */
EMSCRIPTEN_KEEPALIVE lv_obj_t **embf_poll_obj_ptr(void)   { return &g_poll_obj; }
EMSCRIPTEN_KEEPALIVE uint32_t  *embf_poll_code_ptr(void)  { return &g_poll_code; }
EMSCRIPTEN_KEEPALIVE int32_t   *embf_poll_value_ptr(void) { return &g_poll_value; }

/* ── Input events ───────────────────────────────────────────────────────── */

static lv_indev_t      *g_pointer_indev = NULL;
static lv_indev_t      *g_wheel_indev   = NULL;
static lv_point_t       g_pointer_point = {0, 0};
static lv_indev_state_t g_pointer_state = LV_INDEV_STATE_RELEASED;
static int32_t          g_wheel_delta   = 0;
static lv_indev_state_t g_wheel_state   = LV_INDEV_STATE_RELEASED;

static void pointer_read_cb(lv_indev_t *indev, lv_indev_data_t *data)
{
    data->point = g_pointer_point;
    data->state = g_pointer_state;
}

static void wheel_read_cb(lv_indev_t *indev, lv_indev_data_t *data)
{
    data->enc_diff = (int16_t)g_wheel_delta;
    data->state    = g_wheel_state;
    g_wheel_delta  = 0;
}

static void init_input_devices(void)
{
    g_pointer_indev = lv_indev_create();
    lv_indev_set_type(g_pointer_indev, LV_INDEV_TYPE_POINTER);
    lv_indev_set_read_cb(g_pointer_indev, pointer_read_cb);

    g_wheel_indev = lv_indev_create();
    lv_indev_set_type(g_wheel_indev, LV_INDEV_TYPE_ENCODER);
    lv_indev_set_read_cb(g_wheel_indev, wheel_read_cb);
}

/* Called from embf_init after lv_init() */
static void __attribute__((constructor)) _ensure_input_init(void) {}

EMSCRIPTEN_KEEPALIVE
void embf_on_pointer(int x, int y, int pressed)
{
    if (!g_pointer_indev) {
        g_pointer_indev = lv_indev_create();
        lv_indev_set_type(g_pointer_indev, LV_INDEV_TYPE_POINTER);
        lv_indev_set_read_cb(g_pointer_indev, pointer_read_cb);
    }
    g_pointer_point.x = (lv_coord_t)x;
    g_pointer_point.y = (lv_coord_t)y;
    g_pointer_state = pressed ? LV_INDEV_STATE_PRESSED : LV_INDEV_STATE_RELEASED;
}

EMSCRIPTEN_KEEPALIVE
void embf_on_wheel(int delta, int pressed)
{
    if (!g_wheel_indev) {
        g_wheel_indev = lv_indev_create();
        lv_indev_set_type(g_wheel_indev, LV_INDEV_TYPE_ENCODER);
        lv_indev_set_read_cb(g_wheel_indev, wheel_read_cb);
    }
    g_wheel_delta += delta;
    g_wheel_state = pressed ? LV_INDEV_STATE_PRESSED : LV_INDEV_STATE_RELEASED;
}

EMSCRIPTEN_KEEPALIVE
void embf_on_key(int keycode)
{
    /* Future: keyboard input device */
    (void)keycode;
}
