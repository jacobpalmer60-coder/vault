// Tailwind is pre-built into tailwind.css instead of compiled in the browser by
// the Play CDN (which Tailwind says is for development only, and which only
// styles classes after they appear in the page — dynamically inserted content
// could sit unstyled for a moment). Rebuild after changing any classes:
//   npx tailwindcss@3 -i tailwind.src.css -o tailwind.css --minify
// Every class must appear written out in full in the source (no 'bg-' + color).
module.exports = {
  content: ['./*.html', './*.js', '!./scouting-report.html', '!./tailwind.config.js'],
  theme: { extend: {} },
  plugins: []
};
