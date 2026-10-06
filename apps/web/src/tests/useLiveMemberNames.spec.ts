import "fake-indexeddb/auto";

import { effectScope } from "vue";
import { useLiveMemberNames } from "../views/PaymentsView.vue";
import { db } from "../db";
import { settle } from "./support/app";

/** Mount the hook in its own scope, the way a screen's setup does. */
function mountLiveMemberNames() {
  const scope = effectScope();
  const names = scope.run(() => useLiveMemberNames())!;
  return { names, stop: () => scope.stop() };
}

beforeEach(async () => {
  await db.clearAll();
});

describe("useLiveMemberNames", () => {
  it("fills in from the local database without being asked", async () => {
    await db.putMemberNames([{ memberId: "user-2", name: "Ada" }]);
    const { names, stop } = mountLiveMemberNames();

    await settle();

    expect(names.value).toEqual({ "user-2": "Ada" });
    stop();
  });

  it("redraws on a name write the app did not make, such as a pull that named a Member", async () => {
    const { names, stop } = mountLiveMemberNames();
    await settle();

    await db.putMemberNames([
      { memberId: "user-1", name: "Test User" },
      { memberId: "user-2", name: "Ada" },
    ]);
    await settle();

    expect(names.value).toEqual({ "user-1": "Test User", "user-2": "Ada" });
    stop();
  });

  it("keeps the name of a Member who has left every List", async () => {
    // Names belong to the Member, so a departing Membership never takes one
    // with it: their Payments still need to say whose they were.
    await db.putMemberNames([{ memberId: "user-2", name: "Ada" }]);
    const { names, stop } = mountLiveMemberNames();
    await settle();

    await db.memberships.clear();
    await settle();

    expect(names.value).toEqual({ "user-2": "Ada" });
    stop();
  });

  it("stops following the database once the screen is gone", async () => {
    const { names, stop } = mountLiveMemberNames();
    await settle();
    stop();

    await db.putMemberNames([{ memberId: "user-2", name: "Ada" }]);
    await settle();

    expect(names.value).toEqual({});
  });
});
