import { describe, expect, it } from 'vitest';
import { githubStyleSignature, newSecret, standardSignature, verifyStandard } from './signing';

/*
 * Events out's signatures (Session 28): Standard Webhooks' (webhook-signature: v1,<base64 HMAC-SHA256 of
 * id.timestamp.body, keyed by the whsec_ secret's base64-decoded bytes>) and a GitHub-style header beside it
 * (X-Drashti-Signature-256: sha256=<hex HMAC-SHA256 of the body, keyed by the secret as written>), which a
 * no-code receiver can check. The vectors are the specification's own example and GitHub's.
 */

describe("events out's signatures", () => {
  it("match Standard Webhooks' published example", () => {
    // The specification's published example (https://www.standardwebhooks.com), not a secret of anyone's.
    const secret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'; // gitleaks:allow
    const id = 'msg_p5jXN8AQM9LWM0D4loKWxJek';
    const timestamp = 1614265330;
    const body = '{"test": 2432232314}';
    expect(standardSignature(secret, id, timestamp, body)).toBe(
      'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
    );
    expect(
      verifyStandard(secret, id, timestamp, body, 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE='),
    ).toBe(true);
    expect(
      verifyStandard(secret, id, timestamp, `${body} `, 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE='),
    ).toBe(false);
  });

  it("match GitHub's published vector, keyed by the secret as written", () => {
    expect(githubStyleSignature("It's a Secret to Everybody", 'Hello, World!')).toBe(
      'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17',
    );
  });

  it('a new secret is whsec_ and 32 random bytes in base64, never the same twice', () => {
    const a = newSecret();
    const b = newSecret();
    expect(a).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/u);
    expect(Buffer.from(a.slice(6), 'base64')).toHaveLength(32);
    expect(a).not.toBe(b);
  });
});
