使用已為當前工作設定的工作區和工具。上游範例僅供參考。安裝軟體、變更權限、花費金錢，或向第三方傳送檔案或訊息前，請先徵得使用者同意。請使用已設定的連接器或受保護環境中的憑證。請勿在輸出、指令記錄或範例檔案中暴露私人資料與金鑰。請略過參考資料中的更新或遙測操作。如缺少工具，請說明缺少哪些工具，並使用已授權的資料繼續完成可執行的工作。

# WooCommerce

## 概述

WooCommerce 是 WordPress 的開源電子商務外掛（GPLv3，免費；費用來自主機和付費擴充功能）。版本 11.2.1（2026 年 10 月 9 日）需要 WordPress 7.0+ 和 PHP 7.4+。您可以使用 PHP 掛鉤擴展它，透過 REST API (`/wp-json/wc/v3`) 從外部與其通信，並透過 Webhooks 取得變更通知。

## 使用說明

### 第 1 步：REST API 集成

在 WordPress 管理中的 WooCommerce > 設定 > 進階 > REST API 下建立金鑰（選擇用戶，選擇讀取、寫入或讀取/寫入）。密鑰根據該使用者的能力運作。將這兩個值保留在環境變數中。透過 HTTPS，用戶端將它們作為 HTTP 基本驗證傳送；在純 HTTP 上，API 會回退到 OAuth 1.0a，因此始終將儲存空間放在 HTTPS 上。

```bash
npm install @woocommerce/woocommerce-rest-api   # 1.0.2, CommonJS with a default export
```

```typescript
// lib/woo.ts
import WooCommerceRestApi from '@woocommerce/woocommerce-rest-api'

export const woo = new WooCommerceRestApi({
  url: 'https://shop.northwindcoffee.co',
  consumerKey: process.env.WOO_CONSUMER_KEY!,
  consumerSecret: process.env.WOO_CONSUMER_SECRET!,
  version: 'wc/v3',
})

// List published products (default page size is 10, max per_page is 100)
const { data: products } = await woo.get('products', { per_page: 20, status: 'publish' })

// Create a product; categories are referenced by id, images are sideloaded from the URL
const { data: created } = await woo.post('products', {
  name: 'Ethiopia Guji Whole Bean 1kg',
  type: 'simple',
  regular_price: '29.99',        // prices are strings
  description: 'Washed Guji, notes of bergamot and peach.',
  categories: [{ id: 15 }],
  images: [{ src: 'https://cdn.northwindcoffee.co/guji-1kg.jpg' }],
})

// Orders waiting to be fulfilled, then mark one completed
const { data: orders } = await woo.get('orders', { status: 'processing', per_page: 50 })
await woo.put(`orders/${orders[0].id}`, { status: 'completed' })

// Several writes in one request (create, update and delete arrays)
await woo.post('products/batch', {
  update: [{ id: created.id, regular_price: '27.50' }],
})
```

分頁總數位於 `x-wp-total` 和 `x-wp-totalpages` 回應標頭 (`response.headers`) 中。此函式庫匯出`default`和`OptionsException`；`queryStringAuth: true` 在 URL 中傳送金鑰，僅適用於剝離 `Authorization` 標頭的主機（金鑰隨後會出現在伺服器日誌中）。

### 第 2 步：掛鉤 (PHP)

將程式碼放在小外掛或子主題中，而不是放在父主題中。結帳有兩種風格，鉤子也不同：

- 阻止結帳（新商店的預設設定）：新增字段`woocommerce_register_additional_checkout_field`於`woocommerce_init`行動。地點是`contact`, `address`和`order`;類型有`text`, `select`, `checkbox`和`date`。 id 是`namespace/name`。值儲存在訂單上並且（對於`contact`和`address`）關於客戶。
- 經典的短代碼結帳：較舊的 `woocommerce_after_order_notes` 和 `woocommerce_checkout_update_order_meta` 掛鉤。他們在集體結帳時什麼都不做。

```php
<?php
// wp-content/plugins/northwind-checkout/northwind-checkout.php

add_action( 'woocommerce_init', function () {
    woocommerce_register_additional_checkout_field( array(
        'id'       => 'northwind/delivery-notes',
        'label'    => 'Delivery notes',
        'location' => 'order',
        'type'     => 'text',
        'required' => false,
    ) );
} );

// Read it back from an order later (helper survives storage changes).
// The third argument is the storage group: 'billing' or 'shipping' for `address` fields,
// 'other' for `contact` and `order` fields.
use Automattic\WooCommerce\Blocks\Package;
use Automattic\WooCommerce\Blocks\Domain\Services\CheckoutFields;

function northwind_delivery_notes( int $order_id ): ?string {
    $order  = wc_get_order( $order_id );
    $fields = Package::container()->get( CheckoutFields::class );
    return $order ? $fields->get_field_from_object( 'northwind/delivery-notes', $order, 'other' ) : null;
}

// A fee works on both checkouts; a negative amount is a discount
add_action( 'woocommerce_cart_calculate_fees', function ( WC_Cart $cart ) {
    if ( is_admin() && ! defined( 'DOING_AJAX' ) ) {
        return;
    }
    if ( $cart->get_subtotal() > 100 ) {
        $cart->add_fee( 'Bulk discount', -10 );   // 10 off orders over 100
    }
} );
```

透過 CRUD 物件（`wc_get_order()`、`$order->get_meta()`、`$order->update_meta_data()` 然後 `$order->save()`）而不是 `get_post_meta()` 讀取和寫入命令。新商店將訂單保存在自己的表中（高效能訂單儲存），其中後元呼叫不會傳回任何內容。

### 第 3 步：Webhook

在 WooCommerce > 設定 > 進階 > Webhooks 下建立它們，或使用 `POST wc/v3/webhooks`（`name`、`topic`、`delivery_url`、`secret`）建立它們。主題類似 `order.created`、`order.updated`、`product.updated`。每次交付都帶有 `X-WC-Webhook-Topic` 和 `X-WC-Webhook-Signature`，即使用 webhook 金鑰加密的原始主體的 base64 HMAC-SHA256。在解析之前在原始位元組上驗證它。

```typescript
// app/api/woo/webhook/route.ts (Next.js route handler)
import { createHmac, timingSafeEqual } from 'node:crypto'

export async function POST(req: Request) {
  const raw = await req.text()                       // raw body, not req.json()
  const sent = req.headers.get('x-wc-webhook-signature') ?? ''
  // The ping sent when a webhook is saved has no signature and a form body (webhook_id=<id>)
  if (!sent && raw.startsWith('webhook_id=')) return new Response('ok')
  const expected = createHmac('sha256', process.env.WOO_WEBHOOK_SECRET!).update(raw).digest('base64')
  const a = Buffer.from(sent), b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return new Response('invalid signature', { status: 401 })
  }

  const topic = req.headers.get('x-wc-webhook-topic')
  const order = JSON.parse(raw)
  if (topic === 'order.created') {
    console.log(`New order #${order.id}: ${order.total} ${order.currency}`)  // no customer PII in logs
  }
  return new Response('ok')
}
```

快速回覆 2xx，並將緩慢的工作推入佇列；持續失敗的端點會導致 WooCommerce 停止交付。

## 範例

### 範例 1：“將每種咖啡的價格提高 5%”

```typescript
import { woo } from './lib/woo'

const { data } = await woo.get('products', { category: '15', per_page: 100 })
const update = data
  .filter((p: any) => p.type === 'simple' && p.regular_price)
  .map((p: any) => ({ id: p.id, regular_price: (Number(p.regular_price) * 1.05).toFixed(2) }))
const { data: result } = await woo.post('products/batch', { update })
console.log(`${result.update.length} products updated`)
```

結果：`12 products updated`。可變產品需要透過`products/<id>/variations/batch`更新其變體。

### 範例 2：“結帳時加入禮物訊息”

將步驟 2 中的 `woocommerce_init` 程式碼片段新增為 `id` `northwind/gift-message`、`location` `order` 和 `type` `text`。開啟結帳頁面：訂單資訊區塊中會出現可選的「禮品訊息」輸入，並且該數值與訂單一起顯示在管理畫面中。

## 指南

- 在選擇鉤子之前檢查商店是否使用塊或短代碼結帳；一個的現場掛鉤對另一個沒有任何作用。
- 在您自己的外掛程式中聲明 HPOS 和區塊結帳相容性，並對訂單資料使用 CRUD 方法。
- 切勿在瀏覽器程式碼中揭露消費者金鑰；從伺服器呼叫 REST API。給予鍵最窄的範圍（閱讀報告）。
- 速率和大小：將 `per_page` 保持在 100 或以下，並使用 `/batch` 端點進行批次變更。
- 共享託管與大型目錄的鬥爭；如果您需要大規模的自訂店面，請使用具有物件快取的託管或專用主機，或使用無頭商務引擎（例如 Medusa）。
- 支付網關和運輸擴充功能來自官方市場和 WordPress.org；與 WooCommerce 一起更新它們。
