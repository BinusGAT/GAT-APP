import assert from "node:assert/strict";
import test from "node:test";

const {
  canAccessResource,
  canManageButtons,
  canManageUsers,
  canSwitchToRole,
  formatRoleName,
  isPublicResource,
  normalizeRole,
  serializeAllowedRoles,
} = await import("../src/lib/permissions.ts");

const publicApp = { allowed_roles: "all" };
const studentApp = { allowed_roles: "student" };
const internApp = { allowed_roles: "intern" };
const lecturerApp = { allowed_roles: "lecturer" };

test("anonymous users can access only public apps", () => {
  assert.equal(canAccessResource(null, publicApp), true);
  assert.equal(canAccessResource(null, studentApp), false);
});

test("standard roles can access only public and assigned apps", () => {
  const student = { activeRole: "student" };
  const intern = { activeRole: "intern" };
  const lecturer = { activeRole: "lecturer" };
  assert.equal(canAccessResource(student, studentApp), true);
  assert.equal(canAccessResource(student, internApp), false);
  assert.equal(canAccessResource(intern, internApp), true);
  assert.equal(canAccessResource(intern, lecturerApp), false);
  assert.equal(canAccessResource(lecturer, lecturerApp), true);
  assert.equal(canAccessResource(lecturer, publicApp), true);
});

test("all Administrator aliases receive full app access", () => {
  for (const activeRole of ["admin", "administrator", "superadmin"]) {
    assert.equal(normalizeRole(activeRole), "administrator");
    assert.equal(canAccessResource({ activeRole }, studentApp), true);
    assert.equal(canAccessResource({ activeRole }, internApp), true);
    assert.equal(formatRoleName(activeRole), "Administrator");
  }
});

test("users cannot switch to a role that is not assigned", () => {
  assert.equal(canSwitchToRole(["student", "intern"], "intern"), true);
  assert.equal(canSwitchToRole(["student", "intern"], "lecturer"), false);
  assert.equal(canSwitchToRole(["admin"], "administrator"), true);
});

test("only Administrators can manage buttons", () => {
  assert.equal(canManageButtons({ activeRole: "administrator" }), true);
  assert.equal(canManageButtons({ activeRole: "student" }), false);
  assert.equal(canManageButtons(null), false);
});

test("user management requires non-expired Superadmin elevation", () => {
  const now = Date.now();
  assert.equal(canManageUsers({ kind: "user", activeRole: "administrator" }, now), false);
  assert.equal(canManageUsers({ kind: "user", activeRole: "administrator", superadminUntil: now + 1 }, now), true);
  assert.equal(canManageUsers({ kind: "user", activeRole: "administrator", superadminUntil: now - 1 }, now), false);
  assert.equal(canManageUsers({ kind: "user", activeRole: "student", superadminUntil: now + 1 }, now), false);
});

test("permission serialization always preserves Administrator access", () => {
  assert.equal(serializeAllowedRoles([]), "all");
  assert.equal(serializeAllowedRoles(["all", "student"]), "all");
  assert.equal(serializeAllowedRoles(["student", "intern"]), "administrator,student,intern");
  assert.equal(isPublicResource({ allowed_roles: "administrator,student" }), false);
});
