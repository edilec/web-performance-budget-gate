# Performance budget operator notes

Capture Lighthouse reports separately under controlled device, network, viewport, locale, and cache settings. Export every repeat for each budgeted route and assert `complete:true` only when the run list is whole. This gate compares the supplied numeric values; it cannot prove captures are authentic or conditions comparable. A minimum run count prevents a single fast run from standing in for a planned repeated trial, while the named aggregation rule makes the treatment of every run explicit.

Use a disposable local input root containing the budget and capture JSON. The CLI reads only those two files, follows no remote URLs, and creates no output file. It does not publish route names, audit IDs, or measured values in its report. Keep real user data out of captured reports even though the reporter does not echo it.
