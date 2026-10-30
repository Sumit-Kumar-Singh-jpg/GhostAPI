# Motion theme and tool pages

The GhostAPI homepage follows the supplied Motion Sites visual specification: black background,
Inter UI typography, Instrument Serif italic emphasis, metallic pills and glass buttons, a
bottom-centered hero, and short entrance motion. Product content replaces the reference brand
and invented metrics. The supplied MP4 is served locally at /assets/motion-background.mp4.
Font files are also local, downloaded from the Google Fonts CSS URL supplied in the reference.
No third-party asset requests are needed at runtime.

Routes are separate document navigations: /, /website-builder, /shopping and /internships.
The three tool routes share workspace markup and display only the selected tool. Direct links,
refresh and native browser back/forward work normally. Legacy hash links redirect to the proper
tool URL. Shopping-to-builder handoff uses one-use session storage to preserve the selected URL.

The video autoplays muted, loops and uses playsinline/object-fit cover. Pause/play is available.
Reduced-motion preference pauses and hides the video for a black static background, and disables
CSS animation. A mobile menu supports Escape and restores focus to its toggle. Tool screens use
the same typography, monochrome palette and controls while keeping data panels readable.

This is a visual adaptation from the supplied specification; no pixel-perfect comparison to an
original live reference page was available. Authentication, existing API routes, provider behavior,
evidence and scheduling remain in the existing application. The homepage is static and public;
workspace data continues to use the configured API authentication. Work is local only.
