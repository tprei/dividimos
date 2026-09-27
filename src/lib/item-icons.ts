import type { ItemIcon } from "@/types";

export const ITEM_ICON_HINTS: Record<ItemIcon, string> = {
  beer: "cerveja, chopp, long neck, balde de cerveja",
  wine: "vinho, taça de vinho, espumante, sangria",
  cocktail: "drinks e coquetéis: gin tônica, mojito, aperol, margarita",
  spirits: "doses: cachaça, whisky, vodka, tequila, conhaque",
  caipirinha: "caipirinha, caipiroska, caipisaquê, batida",
  soda: "refrigerante, Coca-Cola, guaraná, água tônica, energético",
  juice: "suco natural ou de caixinha, limonada, vitamina",
  water: "água mineral com ou sem gás, água de coco",
  coffee: "café, expresso, cappuccino, chá, chocolate quente",
  pizza: "pizza inteira, fatia ou broto",
  burger: "hambúrguer e lanches X: X-tudo, X-salada, X-bacon",
  fries: "batata frita, fritas, mandioca frita",
  hot_dog: "cachorro-quente, hot dog",
  sandwich: "sanduíche, misto quente, bauru, beirute, wrap, tapioca",
  meat: "carne bovina ou suína: picanha, alcatra, costela, linguiça, calabresa acebolada, churrasco",
  chicken: "frango, galeto, asinha, frango a passarinho",
  fish: "peixe, tilápia, salmão, isca de peixe, bacalhau",
  seafood: "frutos do mar: camarão, lula, polvo, moqueca, casquinha de siri",
  sushi: "comida japonesa: sushi, sashimi, temaki, hot roll, combinado",
  pasta: "massas: macarrão, lasanha, nhoque, risoto",
  plate: "prato feito, PF, executivo, marmita, refeição, buffet por quilo, feijoada",
  soup: "caldos e sopas: caldo de feijão, canja, caldo verde",
  salad: "salada",
  bread: "pão, pão francês, torrada, baguete, pão na chapa",
  dessert: "sobremesas: bolo, torta, pudim, mousse, petit gâteau",
  ice_cream: "sorvete, picolé, milk-shake, casquinha",
  sweets: "doces: chocolate, brigadeiro, bala, paçoca, bombom",
  fruit: "frutas",
  produce: "hortifrúti: legumes, verduras, ervas",
  snacks: "petiscos: amendoim, batata chips, pipoca, azeitona, tábua de frios",
  coxinha: "salgados: coxinha, kibe, esfiha, empada, enroladinho, bolinha de queijo",
  pao_de_queijo: "pão de queijo",
  acai: "açaí na tigela ou no copo",
  pastel: "pastel",
  other: "itens que não são comida nem bebida (limpeza, higiene, utensílios) ou que não cabem em nenhuma outra categoria",
};

export function isItemIcon(value: unknown): value is ItemIcon {
  return typeof value === "string" && Object.hasOwn(ITEM_ICON_HINTS, value);
}
