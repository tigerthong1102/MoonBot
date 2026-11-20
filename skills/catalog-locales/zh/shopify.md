使用已为当前任务配置的工作区和工具。上游示例仅供参考。安装软件、更改权限、花费资金，或向第三方发送文件或消息之前，请征得用户同意。请使用已配置的连接器或受保护环境中的凭据。请勿在输出、命令日志或示例文件中暴露私人数据和密钥。请跳过参考材料中的更新或遥测操作。缺少工具时，请说明缺少哪些工具，并使用现有授权数据继续完成可执行的工作。

# 购物

## 概述

Shopify 是领先的电子商务平台——从简单的商店到企业。使用 Liquid 模板构建自定义主题（无需后端，员工可以通过管理面板编辑内容），通过管理和 Storefront API 使用自定义应用程序扩展功能，或者使用 Hydrogen（React/Remix）完全无头。涵盖全方位：零代码商店设置、主题定制、API 集成和定制无头店面。

## 何时使用

- 建立在线商店（产品、购物车、结帐、付款）
- 自定义 Shopify 主题（布局、设计、部分）
- 无头商务（自定义前端，Shopify 作为后端）
- 由员工管理的商店，非技术人员可以在其中更新产品和内容

## 使用说明

### 使用 Liquid 进行主题开发

```bash
# Install Shopify CLI (5.0 and later)
npm install -g @shopify/cli@latest   # needs Node.js 22.12+ and Git 2.38+
shopify theme init my-theme   # clones Shopify's Skeleton theme (the default)
# For the full Dawn reference theme instead:
# shopify theme init my-theme --clone-url https://github.com/Shopify/dawn.git
cd my-theme
shopify theme dev --store my-store.myshopify.com   # local preview with hot reload (asks you to log in)
shopify theme push --unpublished --theme "Redesign test"   # upload as a new unpublished theme
```

Shopify CLI 5.0 删除了`--poll`标志来自`theme dev`（热重载不需要标志）并且`app logs`和`app logs sources`命令（从以下位置读取 Shopify Functions 日志）`app dev`输出）。大多数命令接受`--json`，但某些命令的 JSON 形状在 5.0 中发生了变化，因此请重新检查解析它的任何脚本。在 CI 中使用`--no-input`;需要身份验证的主题命令停止并打印链接。对于应用程序自动化设置`SHOPIFY_SERVICE_ACCOUNT_TOKEN`; `SHOPIFY_APP_AUTOMATION_TOKEN`和`SHOPIFY_CLI_PARTNERS_TOKEN`已弃用。

#### 主题结构

```
my-theme/
├── layout/
│   └── theme.liquid          # Main layout (wraps all pages)
├── templates/
│   ├── index.json            # Homepage (JSON template)
│   ├── product.json          # Product page (JSON template listing sections)
│   └── collection.json       # Collection page, and so on
├── sections/
│   ├── header.liquid          # Header section (customizable in admin)
│   ├── hero-banner.liquid     # Hero banner section
│   └── footer.liquid
├── blocks/                    # Optional: reusable theme blocks (*.liquid)
├── snippets/
│   └── product-card.liquid    # Reusable product card
├── assets/
│   ├── theme.css
│   └── theme.js
├── config/
│   └── settings_schema.json   # Theme settings (colors, fonts, etc.)
└── locales/
    └── en.default.json        # Translations
```

#### 液体模板

```liquid
{% comment %} sections/hero-banner.liquid — Customizable hero section {% endcomment %}
{% comment %}
  Staff can change the heading, text, image, and button
  through the Shopify admin without touching code.
{% endcomment %}

<section class="hero" style="background-image: url('{{ section.settings.image | image_url: width: 1920 }}')">
  <div class="hero__content">
    <h1>{{ section.settings.heading }}</h1>
    <p>{{ section.settings.text }}</p>
    {% if section.settings.button_text != blank %}
      <a href="{{ section.settings.button_link }}" class="btn">
        {{ section.settings.button_text }}
      </a>
    {% endif %}
  </div>
</section>

{% schema %}
{
  "name": "Hero Banner",
  "settings": [
    { "type": "image_picker", "id": "image", "label": "Background Image" },
    { "type": "text", "id": "heading", "label": "Heading", "default": "Welcome to our store" },
    { "type": "richtext", "id": "text", "label": "Description" },
    { "type": "text", "id": "button_text", "label": "Button Text" },
    { "type": "url", "id": "button_link", "label": "Button Link" }
  ],
  "presets": [{ "name": "Hero Banner" }]
}
{% endschema %}
```

使用 `collection` 和 `product` 设置类型选取集合和产品，然后使用 `{% for product in section.settings.collection.products limit: 4 %}{% render 'product-card', product: product %}{% endfor %}` 循环。

```liquid
{% comment %} snippets/product-card.liquid — Reusable product card {% endcomment %}

<div class="product-card">
  <a href="{{ product.url }}">
    <img
      src="{{ product.featured_image | image_url: width: 400 }}"
      alt="{{ product.featured_image.alt | escape }}"
      loading="lazy"
      width="400"
      height="400"
    >
    <h3>{{ product.title }}</h3>
    <div class="product-card__price">
      {% if product.compare_at_price > product.price %}
        <span class="price--sale">{{ product.price | money }}</span>
        <span class="price--compare">{{ product.compare_at_price | money }}</span>
      {% else %}
        <span>{{ product.price | money }}</span>
      {% endif %}
    </div>
  </a>
  <button class="btn" data-product-id="{{ product.variants.first.id }}">
    {% if product.available %}
      Add to Cart
    {% else %}
      Sold Out
    {% endif %}
  </button>
</div>
```

#### 主题设置（工作人员可编辑）

全局选项（颜色、字体、社交链接）作为设置组存在于 `config/settings_schema.json` 中，例如 `{ "name": "Colors", "settings": [{ "type": "color", "id": "color_primary", "label": "Primary Color", "default": "#000000" }] }`。在 Liquid 中将它们读为 `settings.color_primary`。

### 店面 API（无头）

```typescript
// lib/shopify.ts — Query Shopify Storefront API (pin an API version; new ones ship quarterly, each supported 12+ months)
const SHOPIFY_DOMAIN = "my-store.myshopify.com";
const STOREFRONT_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN;

async function shopifyQuery(query: string, variables?: Record<string, any>) {
  const res = await fetch(`https://${SHOPIFY_DOMAIN}/api/2026-10/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": STOREFRONT_TOKEN!,
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

// Get products
const { data } = await shopifyQuery(`
  query GetProducts($first: Int!) {
    products(first: $first) {
      edges {
        node {
          id
          title
          handle
          priceRange {
            minVariantPrice { amount currencyCode }
          }
          images(first: 1) {
            edges { node { url altText } }
          }
        }
      }
    }
  }
`, { first: 12 });
```

结帐贯穿购物车：使用 `cartCreate` 创建一个（`merchandiseId` + `quantity` 行），然后将买家发送到返回的 `cart.checkoutUrl`。旧的 Checkout 突变已经消失。

### 管理 API（后端/应用程序）

管理API是GraphQL； REST Admin API 是旧版，新的公共应用程序必须使用 GraphQL。使用 `shopify app init` 搭建应用程序（模板：`--template reactRouter` 或 `none`）。在开发仪表板中创建的应用程序通过将 `grant_type=client_credentials`、`client_id` 和 `client_secret` 发布到 `https://my-store.myshopify.com/admin/oauth/access_token` 来获取令牌（当应用程序和商店位于同一组织中时有效；令牌持续 24 小时，因此缓存并刷新它）。切勿将令牌发送到浏览器。

```typescript
// admin/products.ts — Manage products via Admin API
const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

async function adminQuery(query: string, variables?: Record<string, any>) {
  const res = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2026-10/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": ADMIN_TOKEN!,
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

// Create a product
await adminQuery(`
  mutation CreateProduct($product: ProductCreateInput!) {
    productCreate(product: $product) {
      product { id title }
      userErrors { field message }
    }
  }
`, {
  product: {
    title: "Merino Beanie",
    descriptionHtml: "<p>Soft merino wool beanie.</p>",
    vendor: "Northwind Knits",
    productType: "Accessories",
    tags: ["new", "featured"],
  },
});
// New products start unpublished: publish them with publishablePublish.
```

### 无头氢气

```bash
npm create @shopify/hydrogen@latest -- --quickstart   # scaffolds a storefront with product, collection, cart and search routes
cd hydrogen-quickstart && shopify hydrogen dev        # http://localhost:3000
```

Hydrogen 是 Shopify 用于 Storefront API 店面的 React 框架，部署到 Oxygen 或任何 Node 主机。

### 使用 JavaScript 的购物车（Ajax API）

```javascript
// assets/theme.js — Cart functionality (no page reload)
async function addToCart(variantId, quantity = 1) {
  const res = await fetch("/cart/add.js", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [{ id: variantId, quantity }] }),
  });
  const cart = await res.json();
  updateCartUI(cart);
}

// /cart/change.js takes { id: lineItemKey, quantity } to update a line
async function getCart() {
  const res = await fetch("/cart.js");
  return res.json();
}
```

## 示例

### 示例 1：构建自定义 Shopify 主题

**用户提示：**“为服装店创建一个 Shopify 主题，其中包含员工可以编辑的可自定义英雄、产品网格和时事通讯部分。”

该代理将使用架构块、颜色/字体主题设置、产品卡片段和 Ajax 购物车创建 Liquid 部分 - 所有这些都可以由非技术人员通过 Shopify 管理面板进行编辑。

### 示例 2：将外部服务与 Shopify 集成

**用户提示：**“下订单后，将详细信息发送到我们的仓库API并更新库存。”

该代理将创建一个用于订单创建的 Shopify Webhook 侦听器、调用仓库 API 并通过管理 API 更新库存。

### 示例 3：使用 React 的 Headless Shopify

**用户提示：**“使用 Shopify 作为后端构建自定义 React 店面。”

该代理将为产品/系列/购物车设置 Storefront API 查询，处理结账创建并实施产品搜索。

## 指南

- **可定制性部分** - 工作人员应编辑的任何内容都位于带有 `{% schema %}` 的部分中
- **JSON 模板** — 使用 `templates/*.json` 进行拖放部分排序
- **用于购物车的 Ajax API** — `/cart/add.js`、`/cart/change.js`、`/cart.js` 用于无需重新加载的购物车
- **无头店面 API** — GraphQL、面向买家、公共令牌
- **应用程序的管理 API** — GraphQL、服务器端保存的秘密令牌、完整的 CRUD
- **图像优化** — 始终使用 `| image_url: width: X` 滤镜
- **自定义数据的元字段** — 使用自定义字段扩展产品/页面
- **`shopify theme dev`用于本地开发**——热重载，与商店同步；检查与`shopify theme check`前`theme push`
- **结帐由 Shopify 管理** — `checkout.liquid` 消失了；使用结帐 UI 扩展和 Shopify 功能进行自定义
- **固定 API 版本**并每季度更新一次；退役版本悄然前行
- **员工培训** - 部分+设置使主题为非开发人员提供自助服务
