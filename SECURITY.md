# Security

> Drashti is built independently for use at a BAPS mandir. It is not an official BAPS product.

This repository is public: everything in it, every issue and every CI log can be read by anyone. If you find a
security problem in Drashti, report it privately, so that it is fixed before anyone else can read about it.

## Reporting a security problem

- **Report it through the repository's Security tab**: **Report a vulnerability**, at
  https://github.com/Priyansh9121/drashti/security/advisories/new. Only the owner (the maintainer) and you can read
  the report.
- **Never in a public issue**, a pull request, a commit or a comment.
- **Never with a real key or token**: no stream key, password, token, PIN, pairing code, certificate, Gmail address
  or private name in the report. Use placeholder values. If a real one has been written somewhere public, say where,
  never what it is.
- Say what you found, the Drashti version (the line along the very bottom of Drashti's window says it), the computer
  and its system, and the steps that show it.

Something that does not work, but is not a security problem, goes in a
[bug report](https://github.com/Priyansh9121/drashti/issues/new/choose) instead.

## Which versions are looked after

Only the newest release is looked after: https://github.com/Priyansh9121/drashti/releases/latest. Drashti is in
alpha (each release is `1.0.0-alpha.` and a number), and a fix comes in the next release, never in an older one.
Check the problem on the newest release before reporting it, where you can.

## What is in scope

What Drashti keeps and guards, and the ways into it:

- **Stream keys**, and YouTube's sign-in, kept in the system's secure storage;
- **the access list**: whether a computer is let in, its tokens and grants, and this computer's secret for it;
- **the phones' pairing codes and tokens**;
- **the local network's API** (off unless the operator turns it on), and OSC;
- **the node link** between Main and its output nodes;
- **the update check**, and the installers it points to.

How each is kept, and what a window, a page, a phone or a node may do, is in the README's
[Security model](README.md#security-model).
