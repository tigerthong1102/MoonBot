使用已為當前工作設定的工作區和工具。上游範例僅供參考。安裝軟體、變更權限、花費金錢，或向第三方傳送檔案或訊息前，請先徵得使用者同意。請使用已設定的連接器或受保護環境中的憑證。請勿在輸出、指令記錄或範例檔案中暴露私人資料與金鑰。請略過參考資料中的更新或遙測操作。如缺少工具，請說明缺少哪些工具，並使用已授權的資料繼續完成可執行的工作。

# 購物

## 概述

Shopify 是領先的電子商務平台——從簡單的商店到企業。使用 Liquid 模板建立自訂主題（無需後端，員工可以透過管理面板編輯內容），透過管理和 Storefront API 使用自訂應用程式擴充功能，或使用 Hydrogen（React/Remix）完全無頭。涵蓋全方位：零代碼商店設定、主題客製化、API 整合和客製化無頭店面。

## 何時使用

- 建立線上商店（產品、購物車、結帳、付款）
- 自訂 Shopify 主題（版面、設計、部分）
- 無頭商務（自訂前端，Shopify 作為後端）
- 由員工管理的商店，非技術人員可以在其中更新產品和內容

## 使用說明

### 使用 Liquid 進行主題開發

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

Shopify CLI 5.0 刪除了`--poll`標誌來自`theme dev`（熱重載不需要標誌）且`app logs`和`app logs sources`指令（從下列位置讀取 Shopify Functions 日誌）`app dev`輸出）。大多數命令接受`--json`，但某些命令的 JSON 形狀在 5.0 中發生了變化，因此請重新檢查解析它的任何腳本。在 CI 中使用`--no-input`;需要身份驗證的主題命令停止並列印連結。對於應用程式自動化設置`SHOPIFY_SERVICE_ACCOUNT_TOKEN`; `SHOPIFY_APP_AUTOMATION_TOKEN`和`SHOPIFY_CLI_PARTNERS_TOKEN`已棄用。

#### 主題結構

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

#### 液體模板

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

使用 `collection` 和 `product` 設定類型選取集合和產品，然後使用 `{% for product in section.settings.collection.products limit: 4 %}{% render 'product-card', product: product %}{% endfor %}` 循環。

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

#### 主題設定（工作人員可編輯）

全域選項（顏色、字體、社交連結）作為設定組存在於 `config/settings_schema.json` 中，例如 `{ "name": "Colors", "settings": [{ "type": "color", "id": "color_primary", "label": "Primary Color", "default": "#000000" }] }`。在 Liquid 中將它們讀為 `settings.color_primary`。

### 店面 API（無頭）

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

結帳貫穿購物車：使用 `cartCreate` 建立一個（`merchandiseId` + `quantity` 行），然後將買家發送到回傳的 `cart.checkoutUrl`。舊的 Checkout 突變已經消失。

### 管理 API（後端/應用程式）

管理API是GraphQL； REST Admin API 是舊版，新的公共應用程式必須使用 GraphQL。使用 `shopify app init` 建立應用程式（範本：`--template reactRouter` 或 `none`）。在開發儀表板中建立的應用程式透過將 `grant_type=client_credentials`、`client_id` 和 `client_secret` 發佈到 `https://my-store.myshopify.com/admin/oauth/access_token` 來取得令牌（當應用程式和商店位於同一組織中時有效；令牌持續 24 小時，因此快取並刷新它）。切勿將令牌傳送到瀏覽器。

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

### 無頭氫氣

```bash
npm create @shopify/hydrogen@latest -- --quickstart   # scaffolds a storefront with product, collection, cart and search routes
cd hydrogen-quickstart && shopify hydrogen dev        # http://localhost:3000
```

Hydrogen 是 Shopify 用於 Storefront API 商店的 React 框架，部署到 Oxygen 或任何 Node 主機。

### 使用 JavaScript 的購物車（Ajax API）

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

## 範例

### 範例 1：建立自訂 Shopify 主題

**使用者提示：**“為服裝店創建一個 Shopify 主題，其中包含員工可以編輯的可自訂英雄、產品網格和時事通訊部分。”

該代理商將使用架構區塊、顏色/字體主題設定、產品卡片段和 Ajax 購物車建立 Liquid 部分 - 所有這些都可以由非技術人員透過 Shopify 管理面板進行編輯。

### 範例 2：將外部服務與 Shopify 集成

**用戶提示：**“下訂單後，將詳細資訊發送到我們的倉庫API並更新庫存。”

該代理程式將建立一個用於訂單建立的 Shopify Webhook 偵聽器、呼叫倉庫 API 並透過管理 API 更新庫存。

### 範例 3：使用 React 的 Headless Shopify

**用戶提示：**“使用 Shopify 作為後端建立自訂 React 店面。”

該代理商將為產品/系列/購物車設定 Storefront API 查詢，處理結帳建立並實施產品搜尋。

## 指南

- **可自訂性部分** - 工作人員應編輯的任何內容都位於帶有 `{% schema %}` 的部分中
- **JSON 範本** — 使用 `templates/*.json` 進行拖放部分排序
- **用於購物車的 Ajax API** — `/cart/add.js`、`/cart/change.js`、`/cart.js` 用於無需重新加載的購物車
- **無頭店面 API** — GraphQL、面向買家、公共令牌
- **應用程式的管理 API** — GraphQL、伺服器端保存的秘密令牌、完整的 CRUD
- **影像最佳化** — 始終使用 `| image_url: width: X` 濾鏡
- **自訂資料的元欄位** — 使用自訂欄位擴充產品/頁面
- **`shopify theme dev`用於本地開發**——熱重載，與商店同步；檢查與`shopify theme check`前`theme push`
- **結帳由 Shopify 管理** — `checkout.liquid` 消失了；使用結帳 UI 擴充功能和 Shopify 功能進行自訂
- **固定 API 版本**並每季更新一次；退役版本悄悄前進
- **員工培訓** - 部分+設定使主題為非開發人員提供自助服務
