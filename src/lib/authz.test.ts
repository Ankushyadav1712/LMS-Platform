import { describe, expect, it } from "vitest";

import { can, type Actor } from "./authz";

const admin: Actor = { id: "u-admin", role: "ADMIN" };
const instructor: Actor = { id: "u-inst", role: "INSTRUCTOR" };
const otherInstructor: Actor = { id: "u-inst2", role: "INSTRUCTOR" };
const student: Actor = { id: "u-stu", role: "STUDENT" };
const otherStudent: Actor = { id: "u-stu2", role: "STUDENT" };

describe("can.createCourse / can.enroll / can.administrate", () => {
  it.each([
    [admin, true],
    [instructor, true],
    [student, false],
  ])("createCourse(%o) -> %s", (actor, expected) => {
    expect(can.createCourse(actor)).toBe(expected);
  });

  it.each([
    [student, true],
    [instructor, false],
    [admin, false],
  ])("enroll(%o) -> %s", (actor, expected) => {
    expect(can.enroll(actor)).toBe(expected);
  });

  it.each([
    [admin, true],
    [instructor, false],
    [student, false],
  ])("administrate(%o) -> %s", (actor, expected) => {
    expect(can.administrate(actor)).toBe(expected);
  });
});

describe("can.manageCourse — ownership, not just role", () => {
  const course = { instructorId: instructor.id };

  it("allows the owning instructor", () => {
    expect(can.manageCourse(instructor, course)).toBe(true);
  });

  it("denies a different instructor (lateral IDOR)", () => {
    expect(can.manageCourse(otherInstructor, course)).toBe(false);
  });

  it("denies students even if they somehow own the id", () => {
    expect(can.manageCourse(student, { instructorId: student.id })).toBe(false);
  });

  it("allows admins on any course", () => {
    expect(can.manageCourse(admin, course)).toBe(true);
  });
});

describe("can.viewSubmission", () => {
  const submission = { studentId: student.id, courseInstructorId: instructor.id };

  it.each([
    ["author", student, true],
    ["another student", otherStudent, false],
    ["course owner", instructor, true],
    ["unrelated instructor", otherInstructor, false],
    ["admin", admin, true],
  ])("%s -> %s", (_label, actor, expected) => {
    expect(can.viewSubmission(actor, submission)).toBe(expected);
  });
});

describe("can.gradeSubmission", () => {
  const submission = { courseInstructorId: instructor.id };

  it.each([
    ["course owner", instructor, true],
    ["unrelated instructor", otherInstructor, false],
    ["the submitting student", student, false],
    ["admin", admin, true],
  ])("%s -> %s", (_label, actor, expected) => {
    expect(can.gradeSubmission(actor, submission)).toBe(expected);
  });

  it("denies students even if they somehow own the id", () => {
    expect(can.gradeSubmission(student, { courseInstructorId: student.id })).toBe(false);
  });
});

describe("can.changeRole", () => {
  it("allows an admin to change another user's role", () => {
    expect(can.changeRole(admin, { id: student.id })).toBe(true);
  });

  it("blocks self role-change (lockout guard)", () => {
    expect(can.changeRole(admin, { id: admin.id })).toBe(false);
  });

  it.each([instructor, student])("denies non-admins (%o)", (actor) => {
    expect(can.changeRole(actor, { id: otherStudent.id })).toBe(false);
  });
});
