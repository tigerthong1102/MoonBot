# StartupBot website preview

A local, static bilingual preview. No installers or store links are published
until verified release metadata exists. Privacy and terms are drafts requiring
owner review.

```sh
node startupbot-site/build.mjs
node --test startupbot-site/site.test.mjs
python3 -m http.server 8080 --directory startupbot-site/dist
```

The build creates a directory for each route. Serve `dist/` at the domain root.
Deployment, DNS, downloadable artifacts and legal publication are separate
owner-controlled steps.
