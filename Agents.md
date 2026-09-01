Bu repo, upstream 9Router forkudur. Geliştirme sürecinde şu Git ve mimari kurallara kesinlikle uy:

## Branch yapısı

* `main`: Upstream 9Router'ın temiz kopyasıdır.
* `main` branchine kendi özelliklerimizi doğrudan ekleme.
* `mine`: Bizim gerçek ve stabil sürümümüzdür.
* Her yeni özellik için güncel `mine` branchinden ayrı feature branch oluştur:

  * `feature/remember-me`
  * `feature/custom-routing`
  * `feature/dashboard-x`
* Feature tamamlanınca `mine` branchine merge edilir.
* Feature branchleri birbirinden türetilmemeli. Her zaman `mine` tabanlı olmalı.

Akış:

```text
upstream/main
     ↓
main
     ↓
mine
 ├── feature/a
 ├── feature/b
 └── feature/c
```

Upstream güncellemesi geldiğinde:

```text
upstream/main → main → mine
```

`mine → main` yönünde kesinlikle merge yapma.

## Conflict azaltma kuralı

Ana hedefimiz upstream güncellemelerini gelecekte mümkün olduğunca az conflict ile alabilmek.

Bu nedenle:

1. Upstream/core dosyalarını mümkün olduğunca değiştirme.
2. Bir özellik yeni bir dosyada/modülde yapılabiliyorsa core dosyaya kod ekleme.
3. Core dosyada değişiklik zorunluysa mümkün olan en küçük entegrasyon değişikliğini yap.
4. Asıl implementasyonu ayrı dosyalarda tut.
5. Büyük fonksiyonları veya mevcut dosyaları gereksiz yere refactor etme.
6. Sadece stil, formatting, import sırası gibi gereksiz değişiklikler yapma.
7. Feature ile ilgisi olmayan dosyalara dokunma.

Tercih edilen yaklaşım:

```text
core dosya
   ↓
küçük hook / çağrı
   ↓
mine/extensions/... altında gerçek implementasyon
```

Örneğin "Beni Hatırla" özelliği yapılacaksa mevcut auth/login sistemini baştan yazma.

Tercihen:

```text
src/mine/
  auth/
    remember-me.ts
    RememberMeCheckbox.tsx
```

gibi ayrı dosyalar oluştur ve mevcut login/auth dosyalarına yalnızca gerekli minimum bağlantıyı ekle.

## Extension yaklaşımı

Baştan büyük ve karmaşık bir plugin sistemi oluşturma.

Gerektikçe hafif:

* hooks
* registries
* slots
* adapters
* extension modules

kullan.

Amaç 9Router core'u yeniden tasarlamak değil; kendi özelliklerimizi core'dan mümkün olduğunca izole etmek.

Örneğin gerekirse ileride:

```text
src/mine/
  auth/
  providers/
  routing/
  ui/
  hooks/
  config/
```

şeklinde organize et.

## Yeni özellik geliştirirken

Her görevde önce:

1. Güncel `mine` branchinden feature branch oluştur.
2. İlgili upstream kodunu incele.
3. Özelliğin core'a minimum müdahaleyle nasıl yapılacağını belirle.
4. Önce ayrı modül/dosya çözümünü tercih et.
5. Sadece zorunlu entegrasyon noktalarında upstream dosyalarını değiştir.
6. Feature tamamlandıktan sonra test/build çalıştır.
7. Değiştirilen core/upstream dosyalarını ayrıca belirt.
8. Özelliğin gelecekte upstream merge conflict oluşturma riskini değerlendir.

Birden fazla agent/branch aynı anda çalışabilir. Başka feature branchlerindeki değişiklikleri doğrudan alma. Gerekirse güncel `mine` branchini kendi feature branchine merge ederek senkronize ol.

En önemli prensip:

**9Router core'unu mümkün olduğunca bir dependency gibi düşün. Bizim özelliklerimiz `mine` katmanında yaşasın; core'a yalnızca zorunlu ve minimal entegrasyon değişiklikleri yapılsın.**

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
