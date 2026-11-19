使用已为当前任务配置的工作区和工具。上游示例仅供参考。安装软件、更改权限、花费资金，或向第三方发送文件或消息之前，请征得用户同意。请使用已配置的连接器或受保护环境中的凭据。请勿在输出、命令日志或示例文件中暴露私人数据和密钥。请跳过参考材料中的更新或遥测操作。缺少工具时，请说明缺少哪些工具，并使用现有授权数据继续完成可执行的工作。

# WooCommerce

## 概述

WooCommerce 是 WordPress 的开源电子商务插件（GPLv3，免费；费用来自托管和付费扩展）。版本 11.2.1（2026 年 10 月 9 日）需要 WordPress 7.0+ 和 PHP 7.4+。您可以使用 PHP 挂钩扩展它，通过 REST API (`/wp-json/wc/v3`) 从外部与其通信，并通过 Webhooks 获取更改通知。

## 使用说明

### 第 1 步：REST API 集成

在 WordPress 管理中的 WooCommerce > 设置 > 高级 > REST API 下创建密钥（选择用户，选择读取、写入或读取/写入）。密钥根据该用户的能力起作用。将这两个值保留在环境变量中。通过 HTTPS，客户端将它们作为 HTTP 基本身份验证发送；在纯 HTTP 上，API 会回退到 OAuth 1.0a，因此始终将存储放在 HTTPS 上。

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

分页总数位于 `x-wp-total` 和 `x-wp-totalpages` 响应标头 (`response.headers`) 中。该库导出`default`和`OptionsException`； `queryStringAuth: true` 在 URL 中发送密钥，仅适用于剥离 `Authorization` 标头的主机（密钥随后会出现在服务器日志中）。

### 第 2 步：挂钩 (PHP)

将代码放在小插件或子主题中，而不是放在父主题中。结账有两种风格，钩子也不同：

- 阻止结帐（新商店的默认设置）：添加字段`woocommerce_register_additional_checkout_field`于`woocommerce_init`行动。地点是`contact`, `address`和`order`;类型有`text`, `select`, `checkbox`和`date`。 id 是`namespace/name`。值存储在订单上并且（对于`contact`和`address`）关于客户。
- 经典的短代码结帐：较旧的 `woocommerce_after_order_notes` 和 `woocommerce_checkout_update_order_meta` 挂钩。他们在集体结帐时什么也不做。

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

通过 CRUD 对象（`wc_get_order()`、`$order->get_meta()`、`$order->update_meta_data()` 然后 `$order->save()`）而不是 `get_post_meta()` 读取和写入命令。新商店将订单保存在自己的表中（高性能订单存储），其中后元调用不会返回任何内容。

### 第 3 步：Webhook

在 WooCommerce > 设置 > 高级 > Webhooks 下创建它们，或使用 `POST wc/v3/webhooks`（`name`、`topic`、`delivery_url`、`secret`）创建它们。主题类似于 `order.created`、`order.updated`、`product.updated`。每次交付都带有 `X-WC-Webhook-Topic` 和 `X-WC-Webhook-Signature`，即使用 webhook 密钥加密的原始主体的 base64 HMAC-SHA256。在解析之前在原始字节上验证它。

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

快速回复 2xx，并将缓慢的工作推入队列；持续失败的端点会导致 WooCommerce 停止交付。

## 示例

### 示例 1：“将每种咖啡的价格提高 5%”

```typescript
import { woo } from './lib/woo'

const { data } = await woo.get('products', { category: '15', per_page: 100 })
const update = data
  .filter((p: any) => p.type === 'simple' && p.regular_price)
  .map((p: any) => ({ id: p.id, regular_price: (Number(p.regular_price) * 1.05).toFixed(2) }))
const { data: result } = await woo.post('products/batch', { update })
console.log(`${result.update.length} products updated`)
```

结果：`12 products updated`。可变产品需要通过`products/<id>/variations/batch`更新其变体。

### 示例 2：“结帐时添加礼物消息”

将步骤 2 中的 `woocommerce_init` 代码段添加为 `id` `northwind/gift-message`、`location` `order` 和 `type` `text`。打开结帐页面：订单信息块中会出现可选的“礼品消息”输入，并且该值与订单一起显示在管理屏幕中。

## 指南

- 在选择钩子之前检查商店是否使用块或短代码结账；一个的现场挂钩对另一个没有任何作用。
- 在您自己的插件中声明 HPOS 和块结账兼容性，并对订单数据使用 CRUD 方法。
- 切勿在浏览器代码中暴露消费者密钥；从服务器调用 REST API。给予键最窄的范围（阅读报告）。
- 速率和大小：将 `per_page` 保持在 100 或以下，并使用 `/batch` 端点进行批量更改。
- 共享托管与大型目录的斗争；如果您需要大规模的自定义店面，请使用带有对象缓存的托管或专用主机，或者使用无头商务引擎（例如 Medusa）。
- 支付网关和运输扩展来自官方市场和 WordPress.org；与 WooCommerce 一起更新它们。
