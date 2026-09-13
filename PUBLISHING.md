# publishing

the public source repository lives at [Microck/remind-me-later](https://github.com/Microck/remind-me-later).

## publish source changes

run the checks, review the diff, then push through the repository's normal Git workflow.

```sh
npm run check
npm test
git push
```

`npm run publish:github` is a guarded first-publication helper. it checks the active GitHub account, runs the core test suite, commits an explicit source-file list, and creates or updates the public `Microck/remind-me-later` repository. it does not create releases or upload release assets.

## releases

update the plugin metadata, `package.json`, and changelog together. complete the live-client checklist in [TESTING.md](TESTING.md) before calling a release production-verified.

the plugin does not fetch updates or replace itself. users install a newer `RemindMeLater.plugin.js` file manually.
