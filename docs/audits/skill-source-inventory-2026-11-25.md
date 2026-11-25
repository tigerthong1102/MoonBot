# StartupBot skill source audit — 2026-11-25

This is a file inventory against the pinned upstream revisions in `skills/catalog/index.json`, not a functional equivalence, licensing opinion, or production-readiness certification. Counts were collected before this guide-restoration change. A missing path can be deliberately excluded or relocated; a modified file can contain safe adaptations. Refer to each skill’s `SOURCE.md` and `excludedFiles` for context.

The library contained 62 entries. A catalog routing smoke using a fake engine passed 62/62; this did not call external services or test the skill output. Three Office skills excluded OOXML schemas and dependent helpers. ByteDance TTS and Kickart omitted vendor scripts. Product Hunt and media-use each had one path relocated or excluded. The latest upstream versions and separate third-party licenses require further review.

This change preserves eight original Apache-2.0 guides for comparison; it does not restore excluded scripts or make unavailable integrations work. Each source guide was matched to the pinned Git blob before copying. The guides may describe unsafe, unavailable or incompatible setup; the active skill guidance requires compatibility and authorization checks.

| Skill | Upstream files | Identical | Modified | Missing at original path |
| --- | ---: | ---: | ---: | ---: |
| xlsx | 53 | 1 | 2 | 50 |
| pdf | 12 | 8 | 4 | 0 |
| docx | 61 | 1 | 1 | 59 |
| pptx | 58 | 2 | 2 | 54 |
| internal-comms | 6 | 5 | 1 | 0 |
| frontend-design | 2 | 1 | 1 | 0 |
| gws-sheets | 1 | 0 | 1 | 0 |
| recipe-compare-sheet-tabs | 1 | 0 | 1 | 0 |
| recipe-backup-sheet-as-csv | 1 | 0 | 1 | 0 |
| recipe-generate-report-from-sheet | 1 | 0 | 1 | 0 |
| recipe-create-doc-from-template | 1 | 0 | 1 | 0 |
| gws-workflow-meeting-prep | 1 | 0 | 1 | 0 |
| gws-workflow-email-to-task | 1 | 0 | 1 | 0 |
| recipe-collect-form-responses | 1 | 0 | 1 | 0 |
| webapp-testing | 6 | 4 | 2 | 0 |
| google-analytics-data-api-basics | 8 | 7 | 1 | 0 |
| web-perf | 2 | 1 | 1 | 0 |
| site-md | 1 | 0 | 1 | 0 |
| earnings-analysis | 4 | 3 | 1 | 0 |
| comps-analysis | 1 | 0 | 1 | 0 |
| dcf-model | 4 | 2 | 2 | 0 |
| thesis-tracker | 1 | 0 | 1 | 0 |
| hyperframes | 81 | 73 | 8 | 0 |
| hyperframes-cli | 13 | 12 | 1 | 0 |
| gemini-api | 11 | 10 | 1 | 0 |
| campaign-plan | 1 | 0 | 1 | 0 |
| competitive-brief | 1 | 0 | 1 | 0 |
| performance-report | 1 | 0 | 1 | 0 |
| seo-audit | 1 | 0 | 1 | 0 |
| google-ads-api-mcp-setup | 2 | 1 | 1 | 0 |
| google-ads-api-account-diagnostics | 1 | 0 | 1 | 0 |
| apify-ecommerce | 1 | 0 | 1 | 0 |
| shopify | 2 | 1 | 1 | 0 |
| woocommerce | 2 | 1 | 1 | 0 |
| byted-seedance-video-generate | 3 | 1 | 2 | 0 |
| byted-seedream-image-generate | 3 | 1 | 2 | 0 |
| byted-text-to-speech | 7 | 1 | 1 | 5 |
| byted-las-asr-pro | 2 | 0 | 2 | 0 |
| byted-kickart-video-subtitler | 19 | 1 | 1 | 17 |
| byted-las-pdf-parse-doubao | 2 | 0 | 2 | 0 |
| generated-ui | 1 | 0 | 1 | 0 |
| dataviz | 6 | 5 | 1 | 0 |
| translate-docs | 1 | 0 | 1 | 0 |
| chengfeng-cut | 4 | 3 | 1 | 0 |
| chengfeng-subtitle | 3 | 2 | 1 | 0 |
| startup-idea | 2 | 1 | 1 | 0 |
| product-discovery | 2 | 1 | 1 | 0 |
| synthesize-research | 1 | 0 | 1 | 0 |
| write-spec | 1 | 0 | 1 | 0 |
| pricing-strategy | 2 | 1 | 1 | 0 |
| business-finance-fundamentals | 2 | 1 | 1 | 0 |
| producthunt | 13 | 10 | 2 | 1 |
| draft-outreach | 1 | 0 | 1 | 0 |
| pipeline-review | 1 | 0 | 1 | 0 |
| roadmap-update | 1 | 0 | 1 | 0 |
| sprint-planning | 1 | 0 | 1 | 0 |
| team-leadership | 2 | 1 | 1 | 0 |
| gws-shared | 1 | 0 | 1 | 0 |
| gws-docs | 1 | 0 | 1 | 0 |
| gws-drive | 1 | 0 | 1 | 0 |
| gws-forms | 1 | 0 | 1 | 0 |
| media-use | 131 | 103 | 27 | 1 |

Further work: review differences within modified instructions, verify dependencies and commercial redistribution rights for each excluded file, implement safe equivalents where feasible, and exercise each workflow with real tools and authorized service accounts. Do not classify all skills as complete from this inventory.

## Additional verification and open gaps

All 62 catalog entries were invoked with GPT-6-Luna in isolated StartupBot server fixtures using synthetic inputs. Those invocations have different scopes: some created simple local artifacts; many only reported missing inputs or service access. They do not establish upstream equivalence, successful external-service integration or production readiness. The Chengfeng transcript-only fallbacks produced draft suggestions; Chengfeng Studio itself was not available. The webapp-testing fixture did not run a browser.

An isolated packaged macOS app containing PR #72 rendered an 11.2-second, 1080×1920 H.264/AAC video with GPT-6-Luna and licensed stock footage. This verifies a specific local workflow, not AI-generated cinematic footage or general creative quality. A clean-home command-discovery fixture did not find HyperFrames, FFmpeg or Node; the packaging and first-run setup for a clean customer machine remain unverified.

The test explicitly requested no network access, but the HyperFrames 0.9.88 `check` log showed downloads of OpenCV.js and two classifiers. Existing instructions are not an enforcement boundary. An experimental macOS outbound-blocking sandbox blocked Internet access and allowed loopback, but the copied project's browser check failed to launch in that setup. Reliable offline execution and cross-platform behavior remain unresolved; do not claim offline operation until the complete process tree is isolated and verified.
