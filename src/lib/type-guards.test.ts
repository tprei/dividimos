import { describe, it, expect } from "vitest";
import { isPixKeyType } from "./type-guards";

describe("isPixKeyType", () => {
  it.each(["cpf", "email", "phone", "random"])(
    "accepts '%s' as a valid PixKeyType",
    (value) => {
      expect(isPixKeyType(value)).toBe(true);
    },
  );

  it.each(["", "PHONE", "telefone", "cellphone", "celular", null, undefined, 42, {}])(
    "rejects invalid value: %p",
    (value) => {
      expect(isPixKeyType(value)).toBe(false);
    },
  );
});
