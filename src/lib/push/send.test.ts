import { beforeEach, describe, expect, it, vi } from "vitest";

// D87: one push_log row per send; a logging failure never breaks the send.
const sendNotification = vi.fn(async () => undefined);
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => (await import("@/lib/db/testDb")).createTestDb());
vi.mock("@/lib/env", () => ({ env: { VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" } }));
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification } }));

const { db } = await import("@/lib/db");
const { pushLog, pushSubscriptions, users } = await import("@/lib/db/schema");
const { sendPushToAllSubscribers } = await import("./send");

beforeEach(async () => {
  await db.delete(pushLog);
  await db.delete(pushSubscriptions);
  await db.delete(users);
  sendNotification.mockReset();
  sendNotification.mockResolvedValue(undefined);
  const [user] = await db.insert(users).values({ email: "a@example.test", passwordHash: "x", name: "A" }).returning();
  await db.insert(pushSubscriptions).values([
    { userId: user.id, endpoint: "https://push.example.test/1", p256dh: "k", auth: "a" },
    { userId: user.id, endpoint: "https://push.example.test/2", p256dh: "k", auth: "a" },
  ]);
});

describe("sendPush → push_log (D87)", () => {
  it("records title, tag, event, devices attempted/ok and errors", async () => {
    sendNotification.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Object.assign(new Error("Gone"), { statusCode: 410 }));
    await sendPushToAllSubscribers({ title: "Bilen er klar", body: "…", tag: "plan-p1", event: "plan_completed" });
    const [row] = await db.select().from(pushLog);
    expect(row).toMatchObject({ title: "Bilen er klar", tag: "plan-p1", event: "plan_completed", devicesAttempted: 2, devicesOk: 1 });
    expect(row.errors).toContain("410 Gone");
    expect(await db.select().from(pushSubscriptions)).toHaveLength(1); // the dead one is pruned as before
  });

  it("a push_log failure doesn't break the send", async () => {
    const insert = vi.spyOn(db, "insert").mockImplementation(() => {
      throw new Error("push_log missing");
    });
    await expect(sendPushToAllSubscribers({ title: "T", body: "B" })).resolves.toBeUndefined();
    expect(sendNotification).toHaveBeenCalledTimes(2);
    insert.mockRestore();
  });
});
