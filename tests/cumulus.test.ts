/**
 * Unit tests for get_cumulus_status. No network: the profile fetch is passed in.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CUMULUS_PROFILE_PATH, formatCumulusProfile, getCumulusStatus } from "../src/auth-tools/cumulus.js";

const PROFILE = {
  cumulusCardOwner: { firstName: "Anna", lastName: "Muster" },
  cumulusNumber: "2099999999999",
  lsSegment: 3,
  members: ["Anna Muster"],
  memberships: ["CUMULUS", "FAMIGROS"],
  periodToDatePointsBalance: 1234,
};

describe("formatCumulusProfile", () => {
  it("picks out points, number, cardholder and memberships", () => {
    const out = JSON.parse(formatCumulusProfile(PROFILE));
    assert.equal(out.hasCumulus, true);
    assert.equal(out.pointsBalance, 1234);
    assert.equal(out.cumulusNumber, "2099999999999");
    assert.equal(out.cardholder, "Anna Muster");
    assert.deepEqual(out.memberships, ["CUMULUS", "FAMIGROS"]);
    assert.equal(out.isFamigrosMember, true);
    assert.deepEqual(out.raw, PROFILE);
  });

  it("copes with a missing owner and no Famigros membership", () => {
    const out = JSON.parse(formatCumulusProfile({ cumulusNumber: "1", periodToDatePointsBalance: 0, memberships: ["CUMULUS"] }));
    assert.equal(out.cardholder, undefined);
    assert.equal(out.isFamigrosMember, false);
    assert.equal(out.pointsBalance, 0);
  });

  it("says so when there is no Cumulus card", () => {
    const out = JSON.parse(formatCumulusProfile(null));
    assert.equal(out.hasCumulus, false);
    assert.match(out.message, /No Cumulus card/);
  });
});

describe("getCumulusStatus", () => {
  it("uses the website's current address", () => {
    assert.equal(CUMULUS_PROFILE_PATH, "/retentionapi/public/web/v1/cumulus-profile");
  });

  it("returns the profile", async () => {
    const out = JSON.parse(await getCumulusStatus(async () => PROFILE));
    assert.equal(out.pointsBalance, 1234);
  });

  it("treats a 404 as no Cumulus card, like the website", async () => {
    const out = JSON.parse(
      await getCumulusStatus(async () => {
        throw new Error(`GET ${CUMULUS_PROFILE_PATH} -> 404: {"status":404,"error":"Not Found"}`);
      }),
    );
    assert.equal(out.hasCumulus, false);
  });

  it("passes other errors on", async () => {
    await assert.rejects(
      getCumulusStatus(async () => {
        throw new Error(`GET ${CUMULUS_PROFILE_PATH} -> 500: oops`);
      }),
      /-> 500/,
    );
  });
});
