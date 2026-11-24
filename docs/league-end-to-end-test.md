# League end-to-end test

Use the updated iOS build and refresh the admin dashboard. Existing prizes are preserved; the new forms display naira and convert it to minor units on save.

1. In Run the League, enable the banner, clear any automatic-hide time, and save. Enable Show last leaderboard and save its settings separately.
2. Create a clearly named test round with a future start and a short closing window. Enter prizes in naira and verify the app shows the same amounts. Use approved private questions.
3. Edit the scheduled round. Confirm the dashboard and app both show the new start and end, with a countdown in days, hours, and minutes. The old opening time must do nothing.
4. Attempt to schedule an overlapping round. Expect a conflict and an explicit replacement choice. Do not replace unless intended.
5. Wait for the revised opening time. Verify entries open, the banner stays visible, and the opening announcement arrives. Check notification delivery counts in the dashboard.
6. Submit with each participating account. Verify its score appears in the provisional standings and the same account cannot start another attempt for that round.
7. Let the round close. The banner must remain visible. Verify the last leaderboard is visible to an ordinary player and each participating winner.
8. Select the closed round in Run the League. Use Finish this round to review finalists and inspect the payout queue on the same page. Clear the required finalists; each winner should get exactly one pending payout request. Refresh twice to check duplicates are not created.
9. Open League as a winner. Verify the form opens and can be reopened using Complete payout form after dismissal. Submit details; reopen League and verify Under review rather than another blank form. Review submitted details in the dashboard.
10. Approve with the owner account. After an actual transfer, record its real reference using that same owner account. Recording a transfer does not send money. Verify the app shows the updated payout status.
11. Schedule another round. Verify View last leaderboard still opens the completed round and the payout request remains tied to that round.
12. Turn Show last leaderboard off and on, saving each change. Verify player visibility follows the setting. Turn the banner off only when intended, or set an explicit future hide time.

Record any failure with the round name, player, time, and the step number. A simulator build verifies compilation; it does not verify APNs delivery or bank submission on a physical device.
