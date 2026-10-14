# Android APK Signup Attribution

Vercel + Redis/KV + Meta Conversions API starter for attributing successful Android app registrations to Facebook/Instagram landing-page clicks.

## Current status

This repository contains the landing page and initial serverless API scaffolding. It is **not end-to-end complete until the APK developer implements the attribution handoff and the trusted signup backend calls the webhook**.

Direct APK downloads do not provide Google Play Install Referrer. Adding `attr_id` to a download URL does not, by itself, carry that ID through installation. Use a deferred deep-link/attribution provider or a carefully designed first-open handoff. Ordinary Android App Links work for installed apps but do not automatically solve deferred attribution.

## Files

- `index.html`: landing page; configure the APK download URL.
- `api/create-attribution.js`: creates a UUID and stores campaign/click fields for 7 days.
- `api/app-signup.js`: authenticated webhook intended to be called by the trusted signup backend after account creation succeeds.

## Vercel environment variables

Required:
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `META_PIXEL_ID`
- `META_CAPI_ACCESS_TOKEN`
- `APP_SIGNUP_WEBHOOK_SECRET` (strong random secret shared only with your trusted backend)

Optional:
- `META_GRAPH_API_VERSION` (verify the current supported Graph API version before production)
- `META_TEST_EVENT_CODE` (testing only)

Do not put Meta access tokens or the signup webhook secret in HTML or the APK. After changing environment variables, redeploy.

## Landing page configuration

In `index.html`, set `APK_DOWNLOAD_URL` to the real HTTPS APK URL. The current value is intentionally empty. The landing page currently creates a server-side attribution record and appends `attr_id` to the download URL. Your developer must replace/extend this with the selected deferred attribution handoff.

## Trusted signup webhook contract

Only call `POST /api/app-signup` from your trusted signup backend after a signup has actually been created. Headers:
- `Content-Type: application/json`
- `x-signup-webhook-secret: <APP_SIGNUP_WEBHOOK_SECRET>`

Example body:
```json
{
  "attributionId": "UUID-returned-by-create-attribution",
  "signupId": "stable-unique-id-from-your-backend",
  "email": "optional-user-email"
}
```

The `signupId` must be a stable ID for that real account creation. It is used for deduplication; do not use a new random ID for every retry. Do not send raw email to Meta. If supplied, this starter normalizes and SHA-256 hashes it. Collect and transmit matching data only with appropriate notice and consent.

## Important implementation work still needed

1. Select and integrate a supported deferred attribution mechanism for direct APK installs.
2. Implement attribution receipt/persistence in the Android app.
3. Connect the successful signup flow to a trusted backend webhook; do not expose the shared secret in the APK.
4. Review Meta's current App Events/CAPI requirements and confirm the chosen endpoint, action source and user-data fields are valid for this app integration before production.
5. Add rate limiting, input validation, consent handling, monitoring and automated tests.
6. Test in Meta Events Manager with `META_TEST_EVENT_CODE`, then remove it for production.

## Test flow

1. Deploy to Vercel with Redis variables configured.
2. Open the landing page with test UTM parameters and click the download CTA (after setting the APK URL).
3. Verify the attribution record exists in Redis.
4. Install/open the APK and verify the app receives the same attribution ID through the chosen handoff.
5. Complete a test signup; confirm only the trusted backend calls `/api/app-signup`.
6. Verify the Meta response and Events Manager test event.
