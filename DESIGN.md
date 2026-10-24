# Visual reference

Current version 0.4.1 keeps only the enabled-toggle section and local-timezone section in settings. No brand header, logo, footer, save-status row, test link, or version is visible. Saving remains automatic; errors appear only when needed inside the relevant section. Manual mode uses a complete, scrollable combobox/listbox with a flexible left name column and a fixed-width right UTC group. Within that group, all UTC prefixes begin at the same horizontal position and signed numeric suffixes align to the right. Long names cannot move the UTC column. Earlier prompts below are preserved as design history.

Image generation mode: built-in ImageGen, one new `ui-mockup` reference. The generated reference was shown in this conversation. It is not used as a bitmap in the actual extension; the UI is implemented with accessible text and isolated CSS.

## Final prompt

Use case: ui-mockup. Asset type: visual design reference for a tiny Chrome extension selection tooltip, not a marketing page. Design a single compact elegant time-zone comparison popover, centered on a pale neutral background, front-on sharp digital UI. Exactly TWO vertically stacked panels with IDENTICAL styling, identical typography hierarchy, identical padding, identical background and border. No overall heading, no card titles, no logos, no icons, no arrow, no buttons, no explanatory text. Width about 300 CSS px, height about 296 CSS px. Quiet polished minimal editorial style: near-white warm paper surfaces, very subtle gray outer stroke, soft small shadow, 16px outer radius, internal horizontal fine divider, ample readable spacing. Tabular crisp numerals. Each panel has year in small subdued graphite at top, then a single row with date left and a slightly more prominent time right, then timezone name left and UTC offset right at bottom. All text is graphite/charcoal, both panels equally emphasized. First panel exact text: '2026', '10月23日', '10:00', 'PDT', 'UTC−07:00'. Second panel exact text: '2026', '10月24日', '01:00', 'Asia/Shanghai', 'UTC+08:00'. These are sample visual placeholders; final real time calculation will be code. Do not add any words or labels. Produce one refined design, not a collage, no surrounding website.

## Implementation contract

- Version 0.2.1 updates the original visual reference: the year position shows the weekday (周五 / 周六), and integer UTC offsets use UTC-7 / UTC+8. Fractional-hour offsets retain minutes. The original generation prompt above remains as design history.
- One shared renderer and one shared set of CSS rules for both time panels.
- Weekday, date, available time, zone name, UTC offset are the only visible fields. The year remains internal for accurate date and weekday calculations.
- No empty clock element for a date-only selection.
- An undated clock has no weekday in either panel. The source date cell stays empty; the target date cell shows 前一天 / 当天 / 第二天, or the exact two-day relationship for extreme offsets. Both use the same renderer, typography and spacing.
- Source first, local second; their roles are available as accessible labels, not extra visible text.
- Outside click, Escape, resize, or page scroll closes the popup. Text selection within the popup does not close it.
- CSS does not rely on the host website's fonts, theme, or CSS utility classes.

## Version 0.4.0: final SVG icon

The user's latest instruction is to produce the icon as SVG. The final source is `icons/logo.svg`, authored directly as native vector geometry after inspecting the earlier ImageGen reference. It contains one rounded rectangle, a circular clock ring, a rounded hand path and an apricot dot. There are no embedded images, filters, gradients or external resources. The charcoal tile reaches every canvas edge; only the rounded corner cutouts are transparent. Colors are exactly #25272A, #F9F6ED and #FF9B69.

`tools/build-icons.cjs` now renders the SVG master to `icons/logo.png` and all packaged PNG sizes. The earlier raster logo is replaced in the extension. The SVG source is also delivered separately.

### Previous ImageGen reference

Before the user's SVG request, built-in ImageGen was used to edit the original icon. This prompt is retained as reference history; its raster output is not the production master.

### Reference icon prompt

Use case: precise-object-edit. Asset type: final production PNG icon for the Time Lens Chrome extension.
Edit target: the supplied clock icon. Rebuild this same simple design with perfectly clean flat fills. Keep the charcoal tile, off-white circular clock ring, two rounded clock hands, and the single muted apricot dot. Remove the entire blurry dark ghost patch inside the lower-left of the clock, along with every texture, smudge, shadow, gradient, lighting effect, or stray mark. The inside of the clock must be exactly the same uniform solid charcoal as the rest of the tile.
Make the icon much larger on the canvas: the dark rounded-square tile must touch all four canvas edges at their midpoints, with zero outside padding and no surrounding background frame. Only the very small rounded corner cutouts may be transparent. Enlarge the clean clock motif to occupy about 84% of the full canvas width, with bold smooth legible shapes.
Palette: uniform flat charcoal #25272A, solid warm white #F9F6ED, one solid apricot dot #FF9B69. Crisp sharp antialiased geometry. No text, no numbers, no tick marks, no extra symbols, no decorations, no shadows, no blur, no glow, no texture, no photographic rendering. Deliver only the finished single icon, edge-to-edge, ready for 16px and 128px browser icons.

## Version 0.3.0: icon and settings

Two additional built-in ImageGen calls originally produced an icon asset and a settings UI reference. The icon was subsequently replaced by the SVG master described above. The UI reference informed `options.html` / `options.css`; it is not embedded as a screenshot.

### Icon prompt

Use case: logo-brand. Asset type: actual Chrome browser extension app icon for Time Lens, a time-zone converter. Create ONE finished minimal flat vector-style square app icon on a truly transparent background. A charcoal almost-black rounded square badge, containing one off-white bold circular clock/lens ring and two simple thick clock hands, plus a single small muted apricot dot on the ring to suggest another time zone. Extremely reduced geometry, polished contemporary utility app identity, visually balanced and symmetric weight, strong contrast and legible down to 16x16 pixels. Badge fills about 88 percent of the square canvas with equal transparent margins. No words, no letters, no numbers, no tick marks, no watermark, no shadow, no glow, no gradients, no mockup, no additional icon variants. Clean crisp anti-aliased edges and opaque interior shapes; keep the exterior transparent. Deliver just the icon asset.

### Icon cleanup prompt

Edit target: the attached Time Lens icon. Keep exactly the same clock ring, two hands, orange dot, rounded square shape, placement, overall proportions and transparent outer margin. Clean the image for production UI use: remove all stray marks, speckles, dark blotches or ghost shapes inside the clock, especially lower left. Make the charcoal rounded-square fill a perfectly uniform flat #25272A, the ring and hands solid warm white #F9F6ED, and the dot solid muted apricot #FF9B69. No texture, no lighting, no gradients, no shadows. Retain crisp antialiased edges and true transparency outside the rounded square. Do not add text, tick marks, borders, logos, or other content. Only this one icon.

### Settings prompt

Use case: ui-mockup. Asset type: visual reference for the compact settings popup of Time Lens, a Chrome time-zone extension. Create one focused front-facing high-fidelity interface on a pale warm-neutral canvas, a single roughly 360px wide, 420px tall browser extension popup. Minimal and beautiful, quiet premium utility, warm ivory background, charcoal text, soft hairline borders, small radius 14px, restrained warm gray accents, readable Chinese sans serif. Header: a small dark rounded-square abstract clock icon at left, text 'Time Lens', small subtitle '让时间更清楚'. Main section: one horizontal row with text '划词转换', smaller '选中时间，显示本地时区', an enabled charcoal toggle on the right. Fine horizontal divider. Section label '本地时区'. Two-choice segmented control with labels '跟随系统' and '手动选择', first option selected. A refined inset information card with label '当前系统时区', main text 'Asia/Shanghai', compact trailing badge 'UTC+8'. Subtle one-line footer '设置自动保存'. Bottom quiet text link '打开自测页', tiny version 'v0.3.0'. No save button, no giant headline, no gradients, no decorative imagery, no marketing content. Clean spacing and exact functional controls. The generated image is a design reference; the implemented UI will use real interactive controls. Show only one state, no device mockup and no variations.
