# Resumo Simples do Projeto

## O Que É

Um **sistema web** que sincroniza produtos entre o **Bling (ERP)** e dois marketplaces: **Mercado Livre** e **Nuvemshop**.

## O Problema Que Resolve

Hoje você tem produtos cadastrados em três lugares diferentes, com informações incompletas e desalinhadas. Cada marketplace tem campos obrigatórios próprios, e o Bling acaba ficando "pobre" de dados. Você precisa **centralizar tudo no Bling** e distribuir para os canais automaticamente.

## A Ideia Central

**O Bling manda. Os marketplaces ajudam.**

- **Bling é o dono** de: preço, estoque, NCM, EAN, CEST, custo — ninguém sobrescreve.
- **Marketplaces enriquecem** o que o Bling não tem: título otimizado, descrição rica, imagens extras, atributos específicos de canal.
- **Nada fiscal ou financeiro é tocado** por dado vindo de marketplace.

## Como Funciona na Prática

```
1. Lê o produto no Bling
2. Compara com o mesmo produto no ML e na Nuvemshop
3. Decide campo por campo quem tem o melhor valor:
   - Fiscal/financeiro? → Bling sempre
   - Conteúdo vazio ou ruim no Bling? → pega do marketplace
   - Imagens? → junta todas, sem repetir
4. Se algo divergir em campo crítico → gera alerta, nunca sobrescreve
5. Atualiza o Bling e publica nos canais
```

## Os 4 Grupos de Dados

| Grupo | O Que É | Quem Manda |
|---|---|---|
| **A** | Preço, estoque, NCM, CEST, custo, SKU | Bling (intocável) |
| **A.5** | EAN (código de barras) | Bling, mas se vazio, precisa de aprovação humana |
| **B** | Nome, descrição, marca, peso, dimensões | Bling se já tem; senão, marketplace enriquece |
| **C** | Imagens, keywords, vídeos | Soma de todas as fontes |
| **D** | Envio Bling → marketplaces | Preço e estoque vão do Bling para os canais |

## Os 10 "Motores" (Componentes)

Cada um cuida de uma parte:

1. **PIRE** — Descobre qual produto do Bling corresponde a qual anúncio no ML/Nuvemshop
2. **VIR** — Mesma coisa, mas para variações (cor, tamanho)
3. **GVE** — Valida EAN (código de barras) com algoritmo oficial
4. **NVE** — Valida NCM (código fiscal) com 8 dígitos
5. **CQS** — Avalia qualidade do texto (nome, descrição, marca)
6. **IQRE** — Cuida das imagens (deduplica, valida, verifica direitos)
7. **CRE** — Dá 3 notas por produto (uma por canal)
8. **APE** — Faz o envio para os marketplaces de forma atômica
9. **WIG** — Evita processar webhook duplicado
10. **DLM** — Limpa dados velhos e arquiva o que é fiscal

## Decisões Importantes de Segurança

- **NCM nunca é preenchido automaticamente** — precisa de 2 pessoas aprovando
- **EAN do marketplace não entra sozinho** — fica em fila de aprovação humana
- **Divergência fiscal bloqueia publicação** — não ignora silenciosamente
- **Nada é sobrescrito sem rastro** — tudo vai para log com quem, quando, o quê
- **Dados fiscais ficam guardados 5 anos** — obrigação legal
- **Preço abaixo do custo gera alerta crítico** — mas não bloqueia

## Convivência com a Integração Nativa do Bling

O Bling já tem integração nativa com ML e Nuvemshop. **O hub não disputa essa escrita**:

- Enquanto a integração nativa do Bling estiver ligada, é ela quem atualiza estoque e preço de anúncio já publicado.
- O hub cuida de **conteúdo** (título, descrição, imagens) e de **criação de anúncio novo**.
- Para o hub assumir estoque/preço, você precisa **desligar a nativa no Bling primeiro** (manual, por canal).

## Estoque: Regra Clara

- **Estoque publicado** = soma dos depósitos do vendedor marcados como "usar no push"
- **Estoque Full do Mercado Livre** (`meli_facility`) = **propriedade do ML**, o hub não escreve nem lê
- **Kit do Bling** = 1 SKU vendável, não explode em vários anúncios

## O Que Fica de Fora

- Pedidos
- Financeiro
- Emissão de NF-e (continua no Bling)
- Frete e transportadora

## Stack Técnica

- **Backend**: Node.js + TypeScript
- **Banco**: PostgreSQL (com particionamento)
- **Cache/Fila**: Redis + BullMQ
- **Frontend**: Next.js + Tailwind
- **Imagens**: Sharp
- **Deploy**: Docker

## Cronograma

**31 a 46 dias úteis** para o backend completo (sem contar as telas).

Fases principais:
1. Setup e banco (1 semana)
2. Conectores e motores (2-3 semanas)
3. Webhook, push e DLM (1 semana)
4. Testes com dados reais (1 semana)

## O Que Você Ganha

- **Catálogo centralizado** no Bling, com dados completos
- **3 notas de qualidade** por produto (uma por canal)
- **Alertas automáticos** de divergência fiscal
- **Enriquecimento controlado** — você decide o que é automático
- **Sem overselling** — estoque sempre coerente
- **Rastreabilidade total** — sabe quem mudou o quê, quando e por quê

---

**Em uma frase**: É um "maestro" que faz o Bling ser o cérebro do catálogo, usa os marketplaces como fontes de conteúdo, e nunca deixa dado fiscal ou financeiro ser bagunçado por informação externa.
