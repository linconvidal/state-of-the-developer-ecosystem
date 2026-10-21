# State of The Developer Ecosystem Survey

Since 2026, the survey's responses are published on the Cardano chain, as a [CIP-179](https://github.com/mpizenberg/Tessera/blob/main/frontend/cip-179.md) survey. Respondents don't need a wallet: a sponsor, run by Cloudflare Pages, pays their transactions. The 2025 site is in the git history; its questions and answers are in [2025/data/](../2025/data).

Run everything from `survey/`, after `yarn`. To review a translation, see [TRANSLATIONS.md](TRANSLATIONS.md).

- [Try it locally](#try-it-locally)
- [Edit the survey](#edit-the-survey)
- [Deploy](#deploy)
- [How it works](#how-it-works)

## Try it locally

**The questions**, rebuilt from `cip179/2026/survey.json` at each reload:

```
yarn preview
```

Open http://localhost:8179/. Submitting shows the CIP-179 response and its `answers.json` row. Nothing is sent.

**The site**, as respondents will see it, without publishing answers:

```
yarn site --unpublished
yarn dev
```

Open http://localhost:8788/.

**Publishing answers** from your machine needs a published survey and a funded sponsor: do [Deploy](#deploy) steps 1 and 2, then:

```
echo 'TURNSTILE_SECRET="1x0000000000000000000000000000000AA"' >> .dev.vars
yarn db:migrate
yarn site
yarn dev
```

That secret is Turnstile's test secret, which always passes (`2x0000000000000000000000000000000AA` always fails). `yarn preview --sponsor` can publish too. A browser publishes once: use another browser, or "Forget my answers and key" in the preview, to publish again. Your machine and the deployed site share the sponsor wallet: avoid testing locally while the survey is open.

## Edit the survey

1. Edit `cip179/2026/survey.json`, in SurveyJS's format.
2. `yarn cip179` lists what doesn't fit CIP-179 or the widget, such as labels over 64 bytes. It writes nothing.
3. `yarn preview` to try it.
4. Write the survey's files, once there are no errors:

   ```
   yarn cip179 --owner <key hash> --end-epoch <epoch> --out cip179/2026
   ```

   - `definition.metadata.json`: the definition, published on chain. It holds the English texts only.
   - `widget.json`: what the site needs beside it: translations, display conditions, and the answers that end the survey on the welcome screen.
   - `mapping.json`: to turn responses back into `answers.json` rows.

   Commit them.
5. `yarn test` runs the tests of the builder, the site and the sponsor.

## Deploy

Steps for the Preview testnet. For [another network](#other-networks), change the network first.

You need:

- a Cardano wallet on the network: it publishes the survey, and can cancel it;
- a Cloudflare account.

### 1. Publish the survey

1. Pick the end epoch: the current epoch, from `curl -s https://preview.koios.rest/api/v1/tip` (`epoch_no`), plus the number of days to stay open. A Preview epoch lasts one day. Responses count until the end of the end epoch.
2. Write the survey's files, with your wallet's key hash as owner:

   ```
   yarn cip179 --owner <key hash> --end-epoch <epoch> --out cip179/2026
   ```

3. Publish `cip179/2026/definition.metadata.json` with your wallet: import it in Tessera's Create page, and publish. With cardano-cli: `--metadata-json-file definition.metadata.json --json-metadata-detailed-schema --required-signer-hash <key hash>`.
4. In `wrangler.jsonc`, set `SPONSOR_SURVEY` to `<tx id>#0`.

### 2. Fund the sponsor

1. Make its wallet:

   ```
   node cip179/sponsor-key.js
   ```

   It writes the seed phrase to `.dev.vars` and prints the address. If `.dev.vars` already has one, it stops: that wallet is the sponsor.
2. Send test ada to the address, from the [faucet](https://docs.cardano.org/cardano-testnets/tools/faucet). A response costs at most 0.5 ada.
3. Split the wallet into coins, one per respondent publishing at the same time:

   ```
   node cip179/sponsor-split.js --coins 10 --submit
   ```

### 3. Set up Cloudflare

Once. For another network, only steps 3 and 5.

1. Log in:

   ```
   yarn wrangler login
   ```

2. Create the Pages project, named as `name` in `wrangler.jsonc`:

   ```
   yarn wrangler pages project create state-of-cardano-developer-survey-2026 --production-branch main
   ```

3. Create the sponsor's database:

   ```
   yarn wrangler d1 create cip179-sponsor-preview
   ```

   When it offers to add the database to your config, answer no. Put its `database_id` in the `db` entry of `wrangler.jsonc`, then:

   ```
   yarn db:migrate --remote
   ```

4. Create a Turnstile widget, in the Cloudflare dashboard (Turnstile, Add widget), for the hostname `state-of-cardano-developer-survey-2026.pages.dev`. Put its site key as `TURNSTILE_SITE_KEY` in `wrangler.jsonc`, and give its secret key:

   ```
   yarn wrangler pages secret put TURNSTILE_SECRET
   ```

5. Give the sponsor's seed phrase:

   ```
   sed -n 's/^SPONSOR_MNEMONIC="\(.*\)"$/\1/p' .dev.vars | yarn wrangler pages secret put SPONSOR_MNEMONIC
   ```

### 4. Build and deploy

```
yarn site
yarn wrangler pages deploy --branch main
```

`yarn site` stops unless `cip179/2026/` is the survey published as `SPONSOR_SURVEY`. The site is at https://state-of-cardano-developer-survey-2026.pages.dev/.

Commit `cip179/2026/` and `wrangler.jsonc`: the repository says what is deployed.

### 5. Check

Answer the survey on the site and publish: the last screen links to the transaction. The sponsor's logs:

```
yarn wrangler pages deployment tail --project-name state-of-cardano-developer-survey-2026
```

### Update the deployed site

What to do depends on what changed:

- **The page only**: `site/`, its texts in `site/texts/`, the terms. Step 4.
- **The survey, but not its definition**: the translations, display conditions and None labels, which are only in `widget.json`. Rebuild with the published survey's owner and end epoch (`yarn site` prints the end epoch), then check that the definition is unchanged:

  ```
  yarn cip179 --owner <key hash> --end-epoch <epoch> --out cip179/2026
  git diff cip179/2026/definition.metadata.json
  ```

  No difference: step 4. A difference: the next case.
- **The definition**: the English texts, the questions and their options, their order and limits, the end epoch. This is a new survey:
  1. Step 1: pick the end epoch, write the files, publish, and set `SPONSOR_SURVEY`.
  2. Step 4.
  3. Cancel the previous survey with the owner's wallet, in Tessera, so that other CIP-179 tools show it closed.

  The sponsor needs nothing else: it forgets the previous survey's sponsorships, and keeps its coins. Browsers start afresh, since they keep the respondent's key and answers per survey. Responses to the previous survey stay on chain and don't count for the new one, so on Mainnet, don't replace a survey that already has responses.

A display condition changed while the survey is open also changes the export: it drops the answers to questions the new conditions hide.

### Later

- **`migrations/` changed**: `yarn db:migrate --remote`.
- **Cap the spending**: set `SPONSOR_DAILY_CAP`, in lovelace per 24 hours, in the `vars` of `wrangler.jsonc`, then redeploy.
- **Close early**: cancel the survey with the owner's wallet, in Tessera. The sponsor stops within 10 minutes.

### Other networks

Before step 1, in `wrangler.jsonc`, set `SPONSOR_NETWORK` (`preprod` or `mainnet`) and `SPONSOR_KOIOS` (`https://preprod.koios.rest/api/v1` or `https://api.koios.rest/api/v1`). In the steps, use that network's Koios and database name (`cip179-sponsor-preprod`). On Mainnet, give the sponsor its own wallet: move `.dev.vars` away before step 2, and pass `--network mainnet`.

## How it works

**Files.**

- `site/`: the page respondents use, built into `dist/` by `yarn site`, with the survey baked in.
- `cip179/`: the survey builder (`build.js`), the preview (`preview.js`), the site's build (`site.js`), the sponsor (`sponsor*.js`) and the tests.
- `cip179/2026/`: the 2026 survey.
- `functions/api/sponsor/`: the sponsor's endpoints.
- `migrations/`: the sponsor's database.
- `wrangler.jsonc`: the Pages project, its database and vars. `yarn site` takes the network, the survey and the Turnstile site key from there too, so the page and the sponsor agree. Secrets are Pages secrets, and locally in the gitignored `.dev.vars`.

**The site** (`site/flow.js`):

1. A welcome screen, saying that answers are public and permanent. It also has the answers that end the survey there (SurveyJS "complete" triggers): nothing is recorded for them. And a reminder to answer later (`site/reminder.js`): a calendar file, a Google Calendar link, or an email to oneself.
2. The questions, one per screen.
3. A submit screen: Turnstile, then the sponsor. A refusal is told there, and the answers are kept.
4. A thank-you, with a link to the transaction.

A survey past its end epoch, or cancelled, shows as closed. In its last week, the welcome says how soon it closes, and in its last day the submit screen too; an open page closes when the survey does. The page has its texts in nine languages (`site/texts/`, one file each, with the widget's texts for the languages the widget doesn't ship), and offers those the survey also has. A link can choose one: `?lang=es`. The browser keeps the respondent's key, unsent answers and language, for each survey. It requests nothing from other sites before the submit screen.

**The sponsor.** The browser makes a key, and the response's credential is that key.

1. `POST /api/sponsor` checks Turnstile, and that the payload is one valid response to the survey. It builds a transaction from one of its coins, with the response key as required signer, signs it and returns it.
2. The browser signs it too, and `POST /api/sponsor/submit` submits it through Koios.

It pays at most 0.5 ada per response, once per respondent key: a respondent changes their answer with their own wallet. It stops once the survey is cancelled. It tracks its coins in the database, and checks them with Koios every 30 minutes. A transaction spends one coin, so the wallet needs as many coins as respondents publishing at the same time.

**CIP-179.** A multi-select's None item isn't an option on chain: the question takes 0 options, and the widget shows its None box. A condition names it `"none"`, and the export writes it back as `["none"]`. On a single choice, None stays an option.
