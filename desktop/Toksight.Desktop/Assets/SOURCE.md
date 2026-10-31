# Native design assets

- Geist / Geist Mono variable TrueType fonts: copied unchanged from the locked `geist` 1.8.2 npm package; same fonts as the Web UI. SIL Open Font License in `Fonts/LICENSE.txt`.
- Lucide vector geometry: selected icons from locked `lucide-react` 1.61.0, drawn by native XAML shapes. ISC / Feather notices in `Icons/LICENSE.txt`.
- Provider logos: linked at build time from `frontend/public/logos/`; original provenance and MIT license travel with those assets.

Run `npm run web:ci`, then `node scripts/desktop-assets.js` to refresh vendored fonts and icon geometry when the Web design dependencies change. Desktop build/CI uses these checked-in assets and does not install Web dependencies.
