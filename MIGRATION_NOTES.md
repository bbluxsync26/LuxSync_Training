# Migration notes

## 2026-10-25

- Migrated the LuxSync training site into the `uat` branch.
- The supplied file and the latest source revision ended inside `renderDemoScript` and omitted the closing script/body/html content.
- Recovered the missing tail from the last complete source revision (`2fc231b239b8a685acec6114d3bd06c562f729aa`) while retaining the supplied file through the recovery point.
- Verified both inline JavaScript blocks parse successfully.
- Verified the page has no relative file dependencies. Runtime dependencies are Tailwind CDN, Google Fonts, and Lucide from unpkg.
- Production Pages deployment is intentionally triggered only by pushes to `main`. The UAT workflow validates and packages `uat` without publishing it to the production Pages site.
