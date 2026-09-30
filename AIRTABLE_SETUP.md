# Airtable integration setup

The Airtable-connected version is being developed on the `airtable-integration` branch so the live form on `main` remains untouched.

## What changed

- The existing player and goalie layout is preserved.
- Player reviews now ask Forward vs Defense and show only the matching position section.
- Session date, opponent/session, and session type are loaded from Airtable using a session-specific link.
- Submissions are sent to a small Cloudflare Worker, which writes them into the Airtable **Self-Scout Reviews** table.
- The Airtable token stays in Cloudflare and is never exposed in the public GitHub Pages code.
- Player names are typed rather than downloading the roster into the public page. The Worker matches the typed name to the active Airtable roster and validates the selected position.

## 1. Create an Airtable personal access token

Create a token with the minimum scopes needed:

- `data.records:read`
- `data.records:write`

Limit access to the **Yale 2013 AA - Film Self-Scout** base only.

Do not paste the token into GitHub or `index.html`.

## 2. Create a free Cloudflare Worker

Create a Worker in the Cloudflare dashboard and replace its starter code with the contents of `worker.js` from this branch.

Add these Worker settings:

- Secret: `AIRTABLE_TOKEN` = the Airtable personal access token
- Variable: `AIRTABLE_BASE_ID` = `apppvR3uPErIG8GtP`

Deploy the Worker and copy its public `https://...workers.dev` URL.

## 3. Put the Worker URL into the form

In `index.html`, replace:

```
https://REPLACE-WITH-YOUR-WORKER.workers.dev
```

with the Worker URL.

## 4. Test with a session

The form expects a session-specific link:

```
https://josephiacuone.github.io/yale-2013-aa-self-scout/?session=recXXXXXXXXXXXXXX
```

The record ID after `session=` must be an Airtable record from the **Sessions** table.

Before testing, create a test Session record with Date, Session Type, and Opponent / Session filled in.

## 5. Verify before going live

Test at least:

1. One Forward review
2. One Defense review
3. One Goaltender review with a goal block
4. A player name entered incorrectly
5. A player choosing the wrong position

Confirm each successful submission creates exactly one record in **Self-Scout Reviews** and links to the correct Player and Session.

Only after testing should the integration branch be merged into `main`.
