import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SelectField, type SelectOption } from "./select-field";

const options: SelectOption[] = [
  { value: "email", label: "E-mail" },
  { value: "phone", label: "Telefone" },
  { value: "cpf", label: "CPF" },
  { value: "random", label: "Chave aleatória" },
];

function SelectFieldHarness({
  onChange,
}: {
  onChange: (value: string) => void;
}) {
  const [value, setValue] = React.useState("email");
  return (
    <SelectField
      label="Tipo"
      value={value}
      options={options}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
    />
  );
}

describe("SelectField", () => {
  it("reports the chosen value to onChange and shows its label on the trigger", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(<SelectFieldHarness onChange={handleChange} />);

    const trigger = screen.getByRole("combobox", { name: "Tipo" });
    expect(trigger).toHaveTextContent("E-mail");

    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "Telefone" }));

    expect(handleChange).toHaveBeenCalledWith("phone");
    expect(screen.getByRole("combobox", { name: "Tipo" })).toHaveTextContent(
      "Telefone",
    );
  });
});
