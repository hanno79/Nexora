import { describe, expect, it } from "vitest";
import { collectCollaboratorIds, mapCollaboratorUsers } from "../server/collaborators";

describe("collectCollaboratorIds", () => {
  it("includes owner and shared users without duplicates", () => {
    const ids = collectCollaboratorIds("owner-1", [
      { sharedWith: "user-2" },
      { sharedWith: "owner-1" },
      { sharedWith: "user-2" },
      { sharedWith: "user-3" },
    ]);

    expect(ids).toEqual(["owner-1", "user-2", "user-3"]);
  });

  it("ignores blank user ids", () => {
    const ids = collectCollaboratorIds("owner-1", [
      { sharedWith: "" },
      { sharedWith: "  " },
      { sharedWith: " user-2 " },
    ]);

    expect(ids).toEqual(["owner-1", "user-2"]);
  });
});

describe("mapCollaboratorUsers", () => {
  it("maps existing users in collaborator-id order", () => {
    const usersById = new Map([
      ["owner-1", { id: "owner-1", firstName: "A", lastName: "Owner", email: "a@example.com", profileImageUrl: null }],
      ["user-2", { id: "user-2", firstName: "B", lastName: "Editor", email: "b@example.com", profileImageUrl: null }],
    ]);

    const users = mapCollaboratorUsers(["user-2", "missing-1", "owner-1"], usersById);

    expect(users.map((u) => u.id)).toEqual(["user-2", "owner-1"]);
  });
});
