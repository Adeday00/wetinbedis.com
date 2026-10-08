# Google Play Full Gist verifier

The Android app now sends the Google Play purchase token to:

`POST /api/v1/billing/google-play/purchases`

The worker verifies the token with Google Play, acknowledges a purchased product, and grants the `com.davidadekanbi.wetinbedis.fullgist` entitlement only after Google confirms it. Raw purchase tokens are never stored; only a SHA-256 hash is persisted.

Before activating the Play product or uploading the final release:

1. Apply `drizzle/0011_google_play_entitlements.sql` to the production D1 database.
2. Create a Google Cloud service account with Android Publisher access to this Play Console app.
3. Store the downloaded service-account JSON as the worker secret named `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`. Do not commit it or paste it into chat.
4. Deploy the worker and verify `POST /api/v1/billing/google-play/purchases` with a real internal-test purchase.
5. Upload the rebuilt Android bundle from `android/app/build/outputs/bundle/release/app-release.aab` to the internal-testing release.
6. Only after a successful test purchase, activate the Full Gist product and its launch offer.

The worker must use the package name `com.davidadekanbi.wetinbedis` and the product ID `com.davidadekanbi.wetinbedis.fullgist`.
