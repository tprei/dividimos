# Brazilian fintech UX/UI research for Pixwise

**Date**: 2026-03-23
**Status**: Research complete
**Purpose**: Actionable design patterns from successful Brazilian fintech apps to inform Pixwise's bill-splitting UX

---

## Table of contents

1. [Nubank](#1-nubank)
2. [Banco Inter](#2-banco-inter)
3. [PicPay](#3-picpay)
4. [Mercado Pago](#4-mercado-pago)
5. [iFood and Rappi](#5-ifood-and-rappi)
6. [RecargaPay](#6-recargapay)
7. [Pix payment UX best practices](#7-pix-payment-ux-best-practices)
8. [Phone verification: WhatsApp OTP vs SMS](#8-phone-verification-whatsapp-otp-vs-sms)
9. [Color and trust in Brazilian fintech](#9-color-and-trust-in-brazilian-fintech)
10. [Mobile-first patterns for Brazil](#10-mobile-first-patterns-for-brazil)
11. [Portuguese UI copywriting](#11-portuguese-ui-copywriting)
12. [Bill-splitting pain points](#12-bill-splitting-pain-points)
13. [Accessibility and LGPD](#13-accessibility-and-lgpd)
14. [Consolidated recommendations for Pixwise](#14-consolidated-recommendations-for-pixwise)

---

## 1. Nubank

### Visual design language

- **Primary palette**: Signature purple `#9C44DC`, with darker variant `#442C61` and lighter tint `#BC8AE1`. White backgrounds with generous whitespace.
- **Gradients**: Subtle purple-to-violet gradients on card surfaces; otherwise flat, clean surfaces.
- **Shadows**: Minimal. Cards use very light elevation (1-2dp equivalent) to avoid visual clutter.
- **Border radius**: Generous radius on cards (12-16px). Buttons use pill shapes (fully rounded) for primary CTAs.
- **Typography**: Custom "Nu Gellix" typeface. Bold, large headings with significant vertical spacing. Lots of breathing room between sections.
- **Spacing philosophy**: "Purple buttons and lots of space in the screen" is explicitly part of their brand identity. The design communicates confidence through negative space rather than information density.

### Animation patterns

- Page transitions use horizontal slide animations (left/right navigation model).
- Balance hide/reveal uses a fade transition tied to the eye icon toggle.
- Card interactions use subtle scale-on-press feedback.
- Loading states use skeleton screens rather than spinners.
- Settlement confirmations use scale + checkmark draw animations (similar to what Pixwise already plans).

### Trust signals

- **Eye icon for balance privacy**: A toggle in the upper corner hides all monetary values on the home screen. Users strongly requested this extend to the Pix transfer screen as well, indicating it's a deeply expected feature.
- **"Modo Rua" (Street Mode)**: Limits transaction amounts when outside the home location and requires selfie authentication for transfers above a threshold. This shows how seriously Brazilian users take public-screen security.
- **No visible security badges**: Nubank relies on brand trust and clean design rather than padlock icons or encryption labels on every screen.

### Onboarding

- Phone number + CPF verification up front.
- Progressive disclosure: name, then selfie for KYC, then card delivery.
- The app works immediately after basic verification; full features unlock progressively.

### Monetary value display

- Format: `R$ 1.234,56` (symbol, space, period for thousands, comma for decimals).
- The eye icon toggle replaces all values with `R$ ••••` or similar masked characters.
- Investment returns displayed in BRL with historical context to aid decision-making.

### Tab structure (key learning)

After 8 years and 70M+ users, Nubank's single scrolling home screen became unscalable. They restructured around three user mental models:
1. **Day-to-day**: Inflows, outflows, household bills
2. **Planning**: Goals and future organization
3. **Discovery**: Leisure, new services

This tabbed approach was perceived as "cleaner and more organized." **For Pixwise**: the bill detail page could benefit from a similar tab structure (Items | Splits | Settlement) rather than vertical scrolling.

### Design principles (from their published framework)

1. **"Go beyond"**: Think beyond the obvious feature. Example: temporary card blocking when misplaced.
2. **Empathy with diversity**: Build for millions of different humans across demographics and cultures.
3. **Consistency through design tokens**: NuDS (Nu Design System) uses 100+ reusable components with design tokens for color, typography, and spacing across light/dark themes.

### Dark mode implementation

- Pure black `#000000` background for OLED battery savings.
- Neutral gray palette for surface elements (no chromatic interference).
- Purple accent is desaturated and lightened for dark contexts.
- Uses design token fallbacks: screens not yet migrated to the latest design system gracefully degrade.

**Pixwise takeaway**: Your current dark mode tokens (`oklch(0.13 0.02 260)` for background) are close to Nubank's approach but not pure black. Consider offering true OLED black as an option, especially since many Brazilian users are on mid-range Android phones with OLED panels.

---

## 2. Banco Inter

### Visual design language

- **Primary palette**: Orange `#FF7A00` as primary accent, with white and light gray backgrounds.
- **Layout**: Clean card-based interface. Orange is used sparingly for CTAs and navigation highlights.
- **Typography**: Sans-serif, moderate weight. Less dramatic than Nubank's large headings.

### Pix payment flow

- Standard flow: Select Pix > Enter key/scan QR > Review recipient name > Confirm amount > Authenticate > Done.
- Recipient name verification is prominently displayed before confirmation (Banco Central requirement, but Inter makes it very visible).
- Cloud architecture (AWS) ensures high availability; UX optimized for speed with intuitive interfaces.

### Trust signals

- Shows registered recipient name before confirming payment (regulatory requirement that Inter surfaces prominently).
- Biometric authentication (fingerprint/face) before transfer execution.

**Pixwise takeaway**: When generating Pix QR codes for settlement, prominently display the recipient's registered name. This is both a regulatory expectation and a trust signal Brazilian users depend on.

---

## 3. PicPay

### Visual design language

- **Primary palette**: Bright green `#21C25E` as primary, with white backgrounds and subtle grays.
- **Layout**: Card-based home screen with shortcut grid ("Pro dia a dia" section).
- **Redesign scope**: 2024 redesign involved 100+ prototypes co-designed with customers from different Brazilian regions.

### "Pague Junto" (Pay Together) feature -- the closest competitor to Pixwise

This is PicPay's group payment splitting feature:

- **Access path**: Home > "More options" > "Pague Junto" in PicPay Services.
- **How it works**: After making a payment (Pix, boleto, or P2P), the payer can split the total into equal parts or define custom amounts per person.
- **Value range**: R$ 10.00 to R$ 100,000.00 per split.
- **Limitation**: Splitting happens *after* payment, not before. The payer pays first, then requests reimbursement. This is a key difference from Pixwise's real-time model.

### "Cobrar" (Charge) feature

- Create payment links without a CNPJ or website.
- Supports Pix, credit card, or QR Code.
- Designed for informal commerce and quick person-to-person charges.

### Redesign philosophy

- Built an "impact system" that goes beyond a traditional design system.
- Includes narrative functions in navigation (e.g., different notification sounds for different event types).
- Home screen shows a 360-degree view of the user's financial situation upon opening.
- Personalized product/service recommendations based on usage patterns.

**Pixwise takeaway**: PicPay's "Pague Junto" only splits *after* payment. Pixwise's advantage is real-time, item-level splitting *before* payment, with Pix QR codes generated for each participant's share. Highlight this in onboarding copy. Also, the 100+ prototype co-design process with regional diversity is a methodology worth adopting for user testing.

---

## 4. Mercado Pago

### Visual design language

- **Primary palette**: Light blue `#009EE3` as primary, with blue-green accent and white backgrounds.
- **Green for CTAs**: Confirm/pay buttons use green to signal "go" -- a consistent pattern across Latin American payment apps.
- **Layout**: Modular brick-based checkout system. Clean, minimal forms with clear amount display.

### Payment experience design

- **Cognitive load reduction**: Clear display of amounts, payment statuses, and input fields. Minimal steps.
- **Speed-optimized**: Login and payment flows require only a few steps.
- **Multi-audience**: Same design system serves developers, sellers, and buyers.
- **Checkout bricks**: Modular components (Card Payment Brick, Status Screen Brick) that can be assembled into custom flows.

### Trust signals

- Blue tones convey trust and security throughout.
- Green buttons provide clear action affordance.
- Consistent color scheme across all touchpoints reinforces brand recognition.

**Pixwise takeaway**: Use green for the "Pagar" (Pay) CTA button in the settlement flow. Blue/purple for informational elements, green for payment actions. This matches established Brazilian payment app conventions.

---

## 5. iFood and Rappi

### Design patterns relevant to Pixwise

- **Category grids**: iFood uses icon grids on the home screen for quick access to categories. This pattern works well for bill actions (scan, split, pay, history).
- **Real-time tracking**: GPS-based order tracking provides a timeline UI that shows status progression. This maps to Pixwise's settlement timeline component.
- **Filter-heavy UX**: Users filter by price, rating, delivery time. For Pixwise, filtering items by "assigned to me" / "unassigned" / "shared" follows the same mental model.
- **Payment integration**: Both apps deeply integrate Pix as a first-class payment method, with Pix often presented as the default/recommended option.

### Group ordering (limited)

Neither iFood nor Rappi offers built-in group ordering or bill splitting. This is a gap in the market that Pixwise can reference in positioning. Brazilian users currently coordinate group food orders through WhatsApp, manually calculate shares, and send individual Pix payments.

**Pixwise takeaway**: The WhatsApp-to-Pixwise sharing flow is critical. Users already coordinate meals in WhatsApp groups; the share link needs to work seamlessly from WhatsApp with instant preview (Open Graph tags, deep linking).

---

## 6. RecargaPay

### Pix interface

- **Pix with credit card**: A differentiating feature -- pay via Pix using credit card funds, with installment options (starting at 4.99% rate, up to 12x).
- **QR Code generation**: Fee-free QR codes for payments and collections.
- **Pix key registration**: In-app Pix key management.

### Design approach

- Functional, utility-focused interface rather than aspirational branding.
- Home screen organized around payment actions (recharge, pay bills, transfer, Pix).
- Less visual polish than Nubank or PicPay, but high information density per screen.

**Pixwise takeaway**: RecargaPay proves that Pix-first apps succeed with utility over aesthetics. However, Pixwise should aim for Nubank-level polish since the target audience (restaurant-going groups, often younger) has higher design expectations.

---

## 7. Pix payment UX best practices

### Standardized flow across Brazilian banks

Every Brazilian banking app follows a similar Pix flow mandated by Banco Central:

1. **Initiate**: Select "Pix" from home screen or payment menu
2. **Identify recipient**: Enter Pix key (CPF, phone, email, random key) OR scan QR code OR use "copia e cola" (copy-paste)
3. **Verify recipient**: App displays the registered name of the recipient before confirmation
4. **Enter amount**: (Pre-filled for dynamic QR codes)
5. **Review**: Summary screen showing recipient name, key, amount, and source account
6. **Authenticate**: Biometrics or PIN
7. **Confirm**: Success screen with transaction ID and timestamp

### QR code patterns

- **Static QR**: Contains Pix key only; amount entered by payer. Used for storefronts.
- **Dynamic QR**: Contains Pix key + amount + description. Used for specific invoices. This is what Pixwise generates.
- **"Copia e cola"**: Text version of the QR payload. Essential fallback for users who can't scan (single-device usage). The user copies the string, opens their bank app, selects "Pix copia e cola," and pastes.

### Design conventions

- **Recipient name verification**: Always shown before confirmation. Builds trust and prevents errors.
- **Expiration communication**: Best practice to show QR code expiration time clearly. Prevents confusion from expired codes.
- **Post-payment confirmation**: Show transaction ID, timestamp, and recipient details. Enable sharing the receipt.
- **Deep linking**: Payment solutions increasingly use deep links that open the user's banking app directly from the QR code, bypassing the camera/scanner step.

**Pixwise takeaway**: The "copia e cola" fallback is mandatory -- many users will be on the same phone they're using to view Pixwise. They can't scan a QR code displayed on their own screen. Provide a prominent "Copiar codigo Pix" button alongside the QR code. Also show expiration time for dynamic QR codes.

---

## 8. Phone verification: WhatsApp OTP vs SMS

### Brazil-specific data

- Brazil is classified as a "heavy WhatsApp country" with 99% smartphone penetration of WhatsApp.
- 20-40% of users choose WhatsApp OTP when offered alongside SMS.
- WhatsApp messages are significantly cheaper than SMS (up to 90% cost savings).

### Recommended approach for Pixwise

1. **Primary channel**: WhatsApp OTP. Higher delivery rates, lower cost, familiar interface.
2. **Fallback**: SMS OTP. For the minority without WhatsApp (older devices, rare cases).
3. **Implementation**: Use Twilio Verify or similar service that orchestrates between WhatsApp and SMS automatically. The same OTP code works across channels.
4. **UX pattern**: Show "Enviamos um codigo para seu WhatsApp" with a "Nao recebeu? Enviar por SMS" fallback link after 30 seconds.

### Supabase compatibility

Supabase Auth supports phone OTP via SMS (using Twilio, MessageBird, or Vonage). WhatsApp OTP would require a custom provider or using Twilio Verify's WhatsApp channel with a Supabase Edge Function as middleware.

**Pixwise takeaway**: The architecture doc specifies SMS OTP via Supabase. Consider adding WhatsApp as the primary channel with SMS fallback. This matches user expectations in Brazil and reduces cost. The phone number used for OTP is likely the same as the user's Pix key, creating a natural connection.

---

## 9. Color and trust in Brazilian fintech

### What the market uses

| App | Primary | Secondary | CTA | Trust association |
|-----|---------|-----------|-----|-------------------|
| Nubank | Purple `#9C44DC` | White | Purple buttons | Innovation, disruption |
| PicPay | Green `#21C25E` | White | Green | Money, growth, go |
| Mercado Pago | Blue `#009EE3` | Green | Green | Trust, security |
| Banco Inter | Orange `#FF7A00` | White | Orange | Energy, accessibility |
| Itau | Dark blue + orange | White | Orange | Tradition, stability |
| Bradesco | Red `#CC092F` | White | Red | Established, bold |
| C6 Bank | Dark/black | Carbon gray | White text | Premium, sophistication |

### Color psychology findings

- 62-90% of a user's subconscious product judgment is based on color alone, and it happens within 90 seconds.
- Blue and purple dominate fintech because they signal security, stability, and trust.
- Regional note: In some South American contexts, blue can also carry connotations of melancholy -- use it as an accent, not the sole emotional driver.
- Green is universally associated with "go," money, and positive outcomes in Brazilian fintech. Use it for confirmation CTAs.
- Consistency across touchpoints is more important than any single color choice. A cohesive palette builds familiarity and reliability.

### Current Pixwise palette analysis

Pixwise uses `oklch(0.55 0.19 255)` as primary -- this resolves to a medium blue, similar to Mercado Pago's trust-oriented palette. The accent color `oklch(0.70 0.18 155)` is a teal/green, suitable for positive actions and confirmations.

**Pixwise takeaway**: The current palette is well-chosen for trust. Consider making the accent green more prominent for payment CTAs ("Pagar via Pix" button). Keep blue/primary for informational and navigational elements. Avoid using red for anything other than destructive actions or errors -- in Brazilian fintech, red is associated with Bradesco (traditional banking) and warning states.

---

## 10. Mobile-first patterns for Brazil

### Device landscape

- Majority of Brazilian fintech users are on mid-range Android devices (Samsung Galaxy A series, Motorola Moto G series).
- OLED screens are increasingly common even on mid-range devices (relevant for dark mode).
- 4G is the dominant connection; 5G adoption is growing but concentrated in metros.
- Data plans are often limited -- users are cost-conscious about data usage.

### Design constraints

- **Target viewport**: 375px width (iPhone SE equivalent), scale up. This matches Pixwise's current spec.
- **Tap targets**: Minimum 44px (Apple guideline), 48px recommended for thumb-friendly design.
- **Navigation limit**: 5-9 items maximum in any navigation structure (cognitive load research).
- **Image optimization**: Compress aggressively. Use WebP/AVIF. Lazy-load below-fold content.
- **Offline tolerance**: Queue mutations when offline; show clear offline indicator. This is in Pixwise's NFRs already.

### PWA-specific patterns

- PWAs succeed in Brazil because they avoid app store downloads (data cost, storage limitations on budget phones).
- Service worker caching is critical for repeat visits.
- Install prompt should appear after the user completes their first successful action (not immediately).
- The share-link model (WhatsApp distribution) is the primary acquisition channel for PWAs in Brazil.

**Pixwise takeaway**: The zero-install PWA approach is a strong differentiator for the Brazilian market. Prioritize aggressive caching, small bundle size (<200KB initial JS), and the WhatsApp share flow. Show the "Add to home screen" prompt after the first bill is split, not on landing.

---

## 11. Portuguese UI copywriting

### Key linguistic conventions

- **Address**: Use "voce" (informal "you"). Never use "tu" (too regional) or "o senhor/a senhora" (too formal for fintech).
- **Text expansion**: Portuguese text is 15-30% longer than English equivalents. Budget for this in UI layouts.
- **Decimal/thousands**: Comma for decimals, period for thousands. `R$ 1.234,56` not `R$ 1,234.56`.
- **Date format**: `dd/MM/yyyy` (e.g., `23/03/2026`).
- **Phone format**: `(11) 99999-9999` (area code in parens, 5-digit prefix, hyphen, 4-digit suffix).

### Fintech-specific terminology

| English | Brazilian Portuguese | Notes |
|---------|---------------------|-------|
| Split the bill | Dividir a conta / Rachar a conta | "Rachar" is more colloquial, commonly used among friends |
| Pay | Pagar | |
| Amount | Valor | |
| Balance | Saldo | |
| Receipt | Comprovante | Not "recibo" in digital context |
| Send money | Enviar / Transferir | |
| Request money | Cobrar | Literally "to charge" |
| Bill (restaurant) | Conta | Not "fatura" (that's credit card bill) |
| Tip | Gorjeta | |
| Service charge | Taxa de servico | Usually 10% in Brazil |
| Share | Compartilhar | |
| QR Code | QR Code / Codigo QR | Both are used |
| Copy code | Copiar codigo | For Pix copia e cola |
| I already paid | Ja paguei | |
| Confirm received | Confirmar recebimento | |
| Each person's share | Parte de cada um | |
| Split equally | Dividir igualmente | |
| Custom split | Divisao personalizada | |

### Copywriting tone

- Keep it conversational but not slangy. Nubank and PicPay both use a friendly, direct tone.
- Avoid banking jargon. "Transferir via Pix" is better than "Realizar transacao Pix."
- Microcopy matters: "Pronto! Seu Pix foi enviado" (Done! Your Pix was sent) is better than "Transacao concluida com sucesso" (Transaction completed successfully).
- Error messages should be specific and actionable: "Chave Pix nao encontrada. Verifique o numero e tente novamente" rather than "Erro na operacao."

**Pixwise takeaway**: Use "Rachar a conta" in casual contexts (marketing, onboarding) and "Dividir a conta" in functional UI (buttons, headers). Use "voce" consistently. Budget all UI strings for 30% text expansion over English equivalents.

---

## 12. Bill-splitting pain points

### Research findings from UX case studies

**Top pain points users report:**

1. **Calculation complexity**: Manual splitting with shared items, different quantities, and service charges creates errors. The calculation burden increases exponentially with group size.

2. **Fairness disputes**: "I didn't drink wine, but it was split evenly." Users want item-level granularity with the option to mark items as shared or individual.

3. **The "primary payer" problem**: One person pays, then has to chase others for reimbursement. This creates social awkwardness and often results in unpaid debts.

4. **Everyone needs the app**: Splitwise requires all participants to create accounts. This is a major friction point. Tricount solved this with shareable links that work without accounts.

5. **Finding old bills**: Scrolling through endless expense lists to find a specific bill. Search and filtering are consistently requested.

6. **Service charge confusion**: Brazilian restaurants typically add a 10% "taxa de servico" (service charge). Users want this automatically factored into splits.

### What users actually want (from research)

- Simplicity over features. "Every button needs a clear purpose."
- Fast actions, few options. Don't make them think about splitting methodology -- default to equal, let them customize if needed.
- Transparency in calculations. Show the math, not just the result.
- No account requirement for participants. Link-based access is strongly preferred.

**Pixwise takeaway**: These findings validate Pixwise's core design decisions:
- NFC-e scanning eliminates manual item entry (pain point 1)
- Item-level split assignment with equal/percent/fixed modes addresses fairness (pain point 2)
- Pix QR codes for each participant eliminate the primary-payer chase (pain point 3)
- PWA with share links means no install or account for casual participants (pain point 4)
- Add search/filter to the bill list early (pain point 5)
- Auto-detect and split the 10% service charge from NFC-e data (pain point 6)

---

## 13. Accessibility and LGPD

### WCAG 2.1 AA requirements (Pixwise's stated target)

- **Color contrast**: Minimum 4.5:1 for normal text, 3:1 for large text.
- **Touch targets**: Minimum 44x44px.
- **Screen reader**: All interactive elements need accessible labels. Currency values must be read aloud correctly ("quarenta e dois reais e cinquenta centavos" not "R cifrão quarenta e dois vírgula cinquenta").
- **Keyboard navigation**: Full keyboard operability for web version.
- **Motion**: Respect `prefers-reduced-motion`. Disable Framer Motion animations when this is set.
- **Focus indicators**: Visible focus rings on all interactive elements.

### LGPD compliance (Lei Geral de Protecao de Dados)

- **Consent**: Explicit consent for data collection. Show a clear, Portuguese-language privacy notice during onboarding.
- **Data minimization**: Collect only what's needed. For bill participants who join via link, collect only display name -- not CPF or phone unless they want to register.
- **Transparency**: Privacy policy must be "transparent, concise, and accessible" in Portuguese.
- **Right to deletion**: Users must be able to delete their account and associated data.
- **Data portability**: Users can request their data in a portable format.
- **Penalties**: Up to 2% of annual revenue or R$ 50 million per violation.

### Practical implementation for Pixwise

- Add a brief LGPD consent banner on first use: "Usamos seus dados apenas para dividir contas e gerar pagamentos Pix. Leia nossa politica de privacidade."
- Guest participants (link joiners) should see minimal data collection: just a display name field with a note explaining why.
- Provide "Excluir minha conta" in the profile settings.
- Store Pix keys encrypted; display them masked in the UI (e.g., `***.***.***-10` for CPF keys).

---

## 14. Consolidated recommendations for Pixwise

### High-impact design changes

1. **Add "Copiar codigo Pix" button alongside every QR code**. Users on the same phone can't scan their own screen. The copy-paste flow is how 30%+ of Pix transactions happen on mobile.

2. **Green CTA for payment actions**. Change the settlement "Pagar" button to use the accent green. This matches Mercado Pago, PicPay, and standard Brazilian payment conventions.

3. **Eye icon balance toggle**. Add a visibility toggle on the bill detail and settlement screens. Brazilian users expect this from every financial app. Nubank community forums show this is one of the most-requested features.

4. **Tab structure on bill detail page**. Instead of vertical scroll, use tabs: **Itens** | **Divisao** | **Pagamento**. Mirrors Nubank's successful restructuring and reduces cognitive load.

5. **WhatsApp OTP as primary auth channel**. 99% WhatsApp penetration in Brazil, 20-40% preference for WhatsApp OTP, 90% cost savings over SMS.

6. **"Rachar a conta" language in casual contexts**. Use this colloquial term in marketing and onboarding, with "Dividir a conta" for functional UI elements.

### Medium-impact improvements

7. **Show recipient name before Pix confirmation**. When a user is about to pay via Pix, display the registered name associated with the Pix key. This is a regulatory expectation and trust signal.

8. **Service charge auto-detection**. Parse the 10% taxa de servico from NFC-e data and present it as a separate split-able line item. This is a unique pain point in Brazilian dining.

9. **Install prompt timing**. Show "Adicionar a tela inicial" only after the first successful bill split, not on landing.

10. **Offline indicator**. Show a clear "Sem conexao" banner with queued action count when offline. Use warm yellow, not red.

11. **QR code expiration timer**. Display a countdown or "Valido ate HH:MM" on dynamic Pix QR codes.

12. **Skeleton screens everywhere**. Nubank, PicPay, and Mercado Pago all use skeleton loading states. Replace any spinner usage with content-shaped skeletons.

### Design system refinements

13. **Consider pure black for dark mode OLED option**. Current background `oklch(0.13 0.02 260)` is close but not true black. Many mid-range Brazilian Android phones have OLED screens.

14. **Budget for 30% text expansion**. All component widths and layouts must accommodate Portuguese strings that are 15-30% longer than English equivalents.

15. **Mask sensitive data by default**. CPF-based Pix keys should display as `***.***.***-XX`. Phone keys as `(**) *****-XXXX`.

16. **Notification sounds**. PicPay's redesign introduced different sounds for different notification types. Consider a distinct sound for "payment received" vs. "new participant joined."

### Competitive positioning

17. **vs. PicPay "Pague Junto"**: Pixwise splits *before* payment with item-level granularity. PicPay only splits *after* one person pays. This is Pixwise's primary advantage.

18. **vs. Splitwise/Tricount**: Those apps track debts over time. Pixwise settles instantly via Pix. No lingering IOUs.

19. **vs. iFood/Rappi**: Neither offers group bill splitting. WhatsApp groups are the current workaround. Pixwise automates what people already do manually in WhatsApp.

20. **vs. Bank apps**: Bank Pix flows require knowing the exact amount and recipient key. Pixwise calculates amounts automatically from receipt data and generates pre-filled QR codes.

---

## Sources

- [Nubank design system and accessible experiences with Figma](https://www.figma.com/customers/nubank-design-system-accessible-experiences-with-figma/)
- [Design Principles at Nubank](https://medium.com/nubank-design/design-principles-at-nubank-d14317715bb1)
- [How we created Tabs: a new UI for a new financial experience - Building Nubank](https://building.nubank.com/how-we-created-tabs/)
- [The birth of the Dark Mode: a journey into Nubank's app evolution](https://building.nubank.com/the-birth-of-the-dark-mode-a-journey-into-nubanks-app-evolution/)
- [Nu Brand System](https://building.nubank.com/nu-brand-system/)
- [Nubank brand colors](https://www.brandcolorcode.com/nubank)
- [Nubank on Flutter](https://flutter.dev/showcase/nubank)
- [Nubank community: ocultar saldo](https://comunidade.nubank.com.br/t/nu-cad%C3%AA-a-op%C3%A7%C3%A3o-de-ocultar-o-saldo-dispon%C3%ADvel-da-conta/265471)
- [PicPay redesign blog post](https://blog.picpay.com/redesign-app/)
- [PicPay Pague Junto help](https://meajuda.picpay.com/hc/pt-br/articles/10273061599379--Como-dividir-pagamentos-usando-o-Pague-Junto)
- [PicPay app technologies and UX](https://uds.com.br/blog/picpay-app-tecnologias-no-desenvolvimento/)
- [Mercado Pago app design analysis](https://www.designrush.com/best-designs/apps/mercado-pago-app-design)
- [DHNN case study: Mercado Pago](https://dhnn.com/cases/mercadopago/)
- [Banco Inter app development for UX](https://uds.com.br/blog/app-banco-inter-desenvolvimento/)
- [Pix: 7 reasons why it should be the reference design for payments](https://medium.com/@danthelion/pix-7-reasons-why-it-should-be-the-reference-design-for-payments-7ceb77dd9de3)
- [PagBrasil Automatic Pix integration guide](https://www.pagbrasil.com/blog/pix/pagbrasils-automatic-pix-integration-guide-for-developers/)
- [Pix QR codes and the QR revolution](https://xcan.it/pix-qr-codes-why-brazils-instant-pay-system-is-leading-the-qr-revolution/)
- [Stripe guide to Pix payments](https://stripe.com/resources/more/pix-replacing-cards-cash-brazil)
- [Twilio Verify WhatsApp overview](https://www.twilio.com/docs/verify/whatsapp)
- [Supabase phone login docs](https://supabase.com/docs/guides/auth/phone-login)
- [Color psychology in fintech UI design](https://inordo.com/shades-of-trust-how-color-psychology-influences-fintech-ui-design/)
- [Fintech brand color strategy](https://bfaglobal.com/catalyst-fund/insights/getting-your-fintech-brand-right-stand-out-with-color/)
- [Fintech UX best practices 2026](https://www.eleken.co/blog-posts/fintech-ux-best-practices)
- [Mobile banking app design best practices 2026](https://www.purrweb.com/blog/banking-app-design/)
- [Fintech UX design trends 2025](https://adamfard.com/blog/fintech-ux-trends)
- [Microsoft Portuguese (Brazil) localization style guide](https://download.microsoft.com/download/8/e/3/8e349e32-9eb9-4b63-9909-7586b94a24dd/por-bra-StyleGuide.pdf)
- [Splitwise UX case study](https://uxdesign.cc/splitwise-a-ux-case-study-dc2581971226)
- [Redesigning a bill splitting app - UX case study](https://uxdesign.cc/splitting-a-bill-at-a-restaurant-4eab00b42795)
- [Bill splitting app UX case study](https://medium.com/@shruti10234verma/ui-ux-case-study-bill-splitting-app-for-restaurants-49262ebed8fe)
- [Fintech design patterns that build trust](https://phenomenonstudio.com/article/fintech-ux-design-patterns-that-build-trust-and-credibility/)
- [LGPD compliance guide](https://complydog.com/blog/brazil-lgpd-complete-data-protection-compliance-guide-saas)
- [Brazil LGPD overview](https://usercentrics.com/knowledge-hub/brazil-lgpd-general-data-protection-law-overview/)
- [PWA design best practices 2026](https://www.gomage.com/blog/pwa-design/)
- [Pix Figma community file](https://www.figma.com/community/file/1332456827130716664/pix-metodo-de-pagamento-brazilian-payment)
- [Splitify bill split app UI kit](https://www.figma.com/community/file/1312271745297091672/splitify-split-bill-app-ui-kit)
