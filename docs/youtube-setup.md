# Scheduling YouTube streams from Drashti: your Google project

From version 1.0.0-alpha.20 Drashti can schedule a stream on your YouTube channel (its title, description, date and
time, and who can watch) and save that broadcast's stream key into a stream profile by itself, so nobody copies a key
by hand. Going live is Drashti's own **Go live…**, as before: YouTube starts the broadcast when the stream arrives.

For the weekly controls after this one-time setup, see the [Manual's Scheduling on YouTube](manual/stream.md#scheduling-on-youtube) and the [admin's guide, section 27](admin-guide.md#27-scheduling-on-youtube).

To do this, Drashti signs in to YouTube with **your own Google project**: a free project in Google Cloud that only you
control. This guide makes it. It takes about 15 minutes, once, and costs nothing: add no billing account, and nothing
here asks for one.

You do every step yourself. Nobody else needs your password, and the Client ID and Client secret you make go only into
Drashti, typed by you on each computer that schedules or streams: never into a chat or an email. Drashti never opens
or drives your browser for you, except to show Google's own sign-in page, where you sign in yourself.

You need:

- a computer with a web browser;
- **the Google account that manages the mandir's YouTube channel** (its password, and its phone if it asks for 2-step
  verification);
- a channel that can already stream live (YouTube Studio's **Go live** works for it).

---

## 1. Make the project, in Personal mode

1. Sign in to Google with the account that manages the channel. Use a browser window where no other Google account is
   signed in.
2. Go to **console.cloud.google.com/auth/overview/personal** (Google calls this **Personal mode**) and make a project,
   for example `Drashti YouTube`. If Google asks to agree to its terms, read them and agree; if it asks for a billing
   account, stop: none is needed.

Personal mode means only this one Google account can ever sign in with the project. Google then shows no "unverified
app" screen, asks for no verification, and the sign-in does not run out after 7 days. It is a one-time choice: such a
project cannot be changed to another kind later.

**If Personal mode is not offered** to your account, make the project at **console.cloud.google.com** instead, then in
**Google Auth Platform** choose **External** as its user type, leave it in **Testing**, and in **Audience**, under
**Test users**, press **Add users** and add the account that manages the channel. A Testing project works the same in Drashti, with two differences Google makes:
each sign-in shows "Google hasn't verified this app" (choose **Continue**), and it lasts 7 days, after which Drashti
says "Sign in to YouTube again".

## 2. Turn on the YouTube Data API

In the project, go to **APIs & Services › Library**, search for **YouTube Data API v3**, open it and press
**Enable**.

## 3. Allow it to manage YouTube

In **Google Auth Platform › Data Access**, press **Add or Remove Scopes**, tick
`https://www.googleapis.com/auth/youtube` ("Manage your YouTube account"), and save. Drashti asks
for this one permission and nothing else: it makes, lists and ends broadcasts, and reads the channel's name.

## 4. Make the client

In **Google Auth Platform › Clients**, press **Create client**, choose the application type **Desktop app**, name it
`Drashti`, and press **Create**. Google shows the **Client ID** (ending in `.apps.googleusercontent.com`) and the
**Client secret**. Keep this page open for the next step.

## 5. Type them into Drashti

On each computer that schedules or streams, in Pro Mode:

1. Press **Stream** in the header, then **Stream settings**.
2. Under **YouTube**, press **Set up…**, type (or paste, on this computer only) the **Client ID** and the **Client
   secret**, and press **Save**. Drashti keeps them in the computer's own secure storage, as it keeps stream keys, and
   never shows the secret again.

## 6. Sign in

1. Press **Sign in to YouTube…**. Your browser opens Google's page.
2. Choose the account that manages the channel (and the channel, if Google asks which), and allow Drashti.
3. The browser says "Signed in to YouTube. You can close this tab and go back to Drashti." Drashti says **Signed in to
   YouTube** with the channel's name.

**Sign out** in Drashti forgets the sign-in on that computer only. To sign every computer out at once, remove
Drashti's access in your Google account: go to its linked apps page (**myaccount.google.com/linkedapps**), choose
**Access to your Google Account**, then your project's app, **See details**, **Remove access** and **Confirm**.

## 7. The first try: an Unlisted stream

1. In **Stream settings › YouTube**, press **Schedule a stream…**, give a title, choose a time a little ahead,
   leave **Who can watch** on **Unlisted**, and press **Schedule on YouTube**. Its key is saved into the profile.
2. In YouTube Studio, under **Live** (**Manage**), the stream is there as scheduled.
3. In Drashti, press **Go live…** (it names the broadcast) and **Go live**. In YouTube Studio the stream starts by
   itself within a minute; watch it on YouTube.
4. Press **End the stream…** in Drashti: it ends the broadcast on YouTube too.

---

## What it costs, and Google's limits

- **Nothing.** The YouTube Data API's daily allowance is free: 10,000 units a day for your project, starting again at
  midnight Pacific time. Each call Drashti makes costs 1 unit (Google's quota table, November 2026): a schedule is
  3, the list 1, ending 1, and an evening on air with YouTube's state checked about 200.
- **When the day's allowance is used up**, Drashti says so and when it starts again. Nothing stops: a key already
  saved still goes live.
- **Without the internet**, or when Google cannot be reached, scheduling and the list say so plainly; going live with
  a saved key never needs Google, only YouTube's stream servers, as before.
- **A sign-in Google no longer takes** (removed in your account, unused for 6 months, or a Testing project's 7 days)
  is said once: "Sign in to YouTube again". The saved key still goes live.

## How it keeps the stream safe

- Going live asks Google nothing: the broadcast is made to **start by itself** when Drashti's stream arrives.
- The broadcast is made never to **end by itself** (YouTube's Auto-stop off), so a dropped connection never ends it;
  **End the stream…** in Drashti ends it. If YouTube cannot be reached then, the Stream panel offers **End it on
  YouTube** (YouTube Studio can end it too).
- While the stream is on air or recording, its profile keeps its address and key: a schedule cannot change them.
- Each broadcast gets its own new stream key, saved only in the computer's secure storage: never shown, never in the
  library, a backup, the log or diagnostics.
