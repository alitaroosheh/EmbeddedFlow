# 01 — Project Management

## 1.1 Project File

- [x] `.embf` file format defined (JSON-based)
- [x] File is opened and parsed by the extension on open
- [x] Live file watching — preview updates on every save
- [x] Parse errors are shown in the preview panel overlay
- [ ] File format versioning — migration path when schema version bumps
- [ ] Corrupt file recovery (show last valid state, report the error line)

## 1.2 New Project Wizard

- [x] `EmbeddedFlow: New Project` command exists
- [x] Prompts for: folder, project name, LVGL version
- [x] Writes template `.embf` with one page and a Hello World label
- [ ] Display preset picker (common hardware: ESP32 240×320, STM32 480×272, etc.)
- [ ] Color format selection in wizard
- [ ] Orientation selection in wizard
- [ ] Dark / light theme selection in wizard

## 1.3 Project Settings

- [ ] Dedicated "Project Settings" panel/command to edit `project` + `display` + `theme` sections
- [ ] LVGL version can be changed after creation (with a warning if widgets use version-specific APIs)
- [ ] Display size can be changed after creation (repositions out-of-bounds widgets with a warning)

## 1.4 Multi-File Projects

- [ ] Support for `$ref` imports — reuse components/styles across `.embf` files
- [ ] Asset references to external files (fonts, images) resolved relative to the `.embf` file

## 1.5 Project Validation

- [x] JSON Schema validation (VSCode inline errors via `jsonValidation`)
- [ ] Semantic validation: duplicate widget IDs detected and reported
- [ ] Semantic validation: widget references (e.g. event target IDs) verified to exist
- [ ] Validation runs before every code generation or export

## 1.6 Workspace / Multi-Root Support

- [ ] Extension activates correctly in multi-root VSCode workspaces
- [ ] Each `.embf` file gets its own independent preview panel
- [ ] Panels are restored across VSCode restarts (`retainContextWhenHidden` already set)
