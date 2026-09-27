export const ITEM_ICON_HINTS = {
  beer: "cerveja, chopp, long neck, balde de cerveja",
  wine: "vinho, taça de vinho, espumante, sangria",
  cocktail: "drinks e coquetéis: gin tônica, mojito, aperol, margarita",
  spirits: "doses: cachaça, whisky, vodka, tequila, conhaque",
  caipirinha: "caipirinha, caipiroska, caipisaquê, batida",
  soda: "refrigerante, Coca-Cola, guaraná, água tônica, energético, chá gelado, kombucha",
  juice: "suco natural ou de caixinha, limonada, vitamina, smoothie, caldo de cana",
  water: "água mineral com ou sem gás, água de coco",
  coffee: "café, expresso, cappuccino, chá, chocolate quente, café em pó ou em cápsula, chimarrão, tereré",
  pizza: "pizza inteira, fatia ou broto",
  burger: "hambúrguer e lanches X: X-tudo, X-salada, X-bacon, xis",
  fries: "batata frita, fritas, mandioca frita, onion rings, polenta frita",
  hot_dog: "cachorro-quente, hot dog",
  sandwich: "sanduíche, misto quente, bauru, beirute, wrap, tapioca, burrito",
  meat: "carne bovina ou suína: picanha, alcatra, costela, linguiça, calabresa acebolada, churrasco, espetinho, churrasquinho",
  chicken: "frango, galeto, asinha, frango a passarinho, frango xadrez",
  fish: "peixe, tilápia, salmão, isca de peixe, bacalhau",
  seafood: "frutos do mar: camarão, lula, polvo, moqueca, casquinha de siri",
  sushi: "comida japonesa: sushi, sashimi, temaki, hot roll, combinado, poke, gyoza",
  pasta: "massas: macarrão, lasanha, nhoque, risoto, yakisoba",
  plate: "prato feito, PF, executivo, marmita, refeição, buffet por quilo, feijoada, estrogonofe, parmegiana, picadinho, baião de dois, galinhada, escondidinho, cuscuz, omelete",
  soup: "caldos e sopas: caldo de feijão, canja, caldo verde, lamen",
  salad: "salada",
  bread: "pão, pão francês, torrada, baguete, pão na chapa, pão de alho, pão de forma, bisnaguinha",
  dessert: "sobremesas: bolo, torta, pudim, mousse, petit gâteau",
  ice_cream: "sorvete, picolé, milk-shake, casquinha",
  sweets: "doces: chocolate, brigadeiro, bala, paçoca, bombom, biscoitos e bolachas",
  fruit: "frutas",
  produce: "hortifrúti: legumes, verduras, ervas",
  pantry: "mercearia: arroz, feijão, açúcar, óleo, farinha, farofa pronta, sal, temperos, molhos, enlatados como atum, sardinha e milho",
  dairy: "leite, iogurte, manteiga, requeijão, creme de leite, leite condensado, achocolatado",
  cheese: "queijos e frios de mercado: mussarela, prato, minas, coalho, presunto, mortadela, peito de peru",
  eggs: "ovos: dúzia, cartela, ovos de codorna",
  ice: "gelo, saco de gelo",
  charcoal: "carvão, acendedor de churrasqueira",
  household: "limpeza e higiene: detergente, sabão, papel higiênico, guardanapo, copos e pratos descartáveis, sacola",
  snacks: "petiscos: amendoim, batata chips, pipoca, azeitona, tábua de frios, salgadinho de pacote, batata palha",
  coxinha: "salgados: coxinha, kibe, esfiha, empada, enroladinho, bolinha de queijo, acarajé, bolinho de bacalhau",
  pao_de_queijo: "pão de queijo",
  acai: "açaí na tigela ou no copo",
  pastel: "pastel",
  other: "taxas e serviços (couvert artístico, taxa de entrega, rolha, embalagem) e itens que não cabem em nenhuma outra categoria",
};

export type ItemIcon = keyof typeof ITEM_ICON_HINTS;

const ITEM_ICON_KEY_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

export function isItemIcon(value: unknown): value is ItemIcon {
  return typeof value === "string" && Object.hasOwn(ITEM_ICON_HINTS, value);
}

export function isItemIconKey(value: unknown): value is string {
  return typeof value === "string" && ITEM_ICON_KEY_PATTERN.test(value);
}
