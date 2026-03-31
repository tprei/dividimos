import type { PixKeyType } from "@/types";

function crc16CCITT(payload: string): string {
  const polynomial = 0x1021;
  let crc = 0xffff;

  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ polynomial) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function tlv(id: string, value: string): string {
  const length = value.length.toString().padStart(2, "0");
  return `${id}${length}${value}`;
}

export interface PixPayload {
  pixKey: string;
  merchantName: string;
  merchantCity: string;
  amountCents: number;
  txId?: string;
}

export function generatePixCopiaECola(payload: PixPayload): string {
  const amount = (payload.amountCents / 100).toFixed(2);

  const merchantAccountInfo =
    tlv("00", "br.gov.bcb.pix") + tlv("01", payload.pixKey);

  let pixString = "";
  pixString += tlv("00", "01");
  pixString += tlv("26", merchantAccountInfo);
  pixString += tlv("52", "0000");
  pixString += tlv("53", "986");
  pixString += tlv("54", amount);
  pixString += tlv("58", "BR");
  pixString += tlv(
    "59",
    payload.merchantName
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .substring(0, 25),
  );
  pixString += tlv(
    "60",
    payload.merchantCity
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .substring(0, 15),
  );
  pixString += tlv("62", tlv("05", payload.txId || "***"));
  pixString += "6304";

  const checksum = crc16CCITT(pixString);
  return pixString + checksum;
}

export function validatePixKey(key: string, type: PixKeyType): boolean {
  switch (type) {
    case "cpf":
      return /^\d{11}$/.test(key);
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key);
    case "random":
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
    default:
      return false;
  }
}

export function maskPixKey(key: string): string {
  if (/^\d{11}$/.test(key)) {
    return `***.***.*${key.slice(7, 9)}*-${key.slice(9)}`;
  }
  if (key.includes("@")) {
    const [local, domain] = key.split("@");
    return `${local.charAt(0)}${"*".repeat(Math.max(1, local.length - 2))}${local.charAt(local.length - 1)}@${domain}`;
  }
  if (key.includes("-") && key.length > 20) {
    return `${key.slice(0, 8)}...${key.slice(-4)}`;
  }
  return key;
}
