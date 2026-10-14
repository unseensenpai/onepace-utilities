# Contributing

[English](#english) · [Türkçe](#türkçe) · [Español](#español)

---

## English

Thanks for helping improve OnePace Utilities.

### Reporting bugs and ideas

[Open an issue](https://github.com/unseensenpai/onepace-utilities/issues/new/choose) and pick the bug report or feature request form. For bugs, include the site and episode URL, the video source (for example AitrVip or Sibnet), your browser, and the extension version. Console lines starting with `[Arc Master]` help a lot.

### Working on the code

1. Fork the repository and create a branch from `main`, for example `fix/source-autoselect`.
2. Load the folder with **Load unpacked** on your browser's extensions page, and reload the extension after each change.
3. Run the tests with Node.js 22 or later:
   ```sh
   npm test
   ```
4. Keep changes focused and match the surrounding code style. Add or update tests in `test/` for logic in `src/shared/`.
5. Use [Conventional Commits](https://www.conventionalcommits.org/) messages: `feat:`, `fix:`, `docs:`, `chore:`, `style:`.
6. Open a pull request to `main` and fill in the template.

### Project layout

- `src/content/`: one content script per site (`content.js` for OnePaceTR, `animpow.js`, `tranime.js`) and `player-frame.js` for embedded players
- `src/shared/`: logic shared by the content scripts, covered by tests
- `src/background/service-worker.js`: forwards messages between pages and player frames

---

## Türkçe

OnePace Utilities'i geliştirmeye yardım ettiğin için teşekkürler.

### Hata ve fikir bildirme

Bir [issue aç](https://github.com/unseensenpai/onepace-utilities/issues/new/choose) ve hata bildirimi ya da özellik isteği formunu seç. Hatalarda site ve bölüm adresini, video kaynağını (örneğin AitrVip veya Sibnet), tarayıcını ve eklenti sürümünü yaz. `[Arc Master]` ile başlayan Console satırları çok yardımcı olur.

### Kod üzerinde çalışma

1. Depoyu fork'la ve `main`'den bir dal aç, örneğin `fix/source-autoselect`.
2. Klasörü tarayıcının eklentiler sayfasında **Paketlenmemiş öğe yükle** ile yükle ve her değişiklikten sonra eklentiyi yenile.
3. Testleri Node.js 22 veya üstüyle çalıştır:
   ```sh
   npm test
   ```
4. Değişiklikleri odaklı tut ve çevredeki kod stiline uy. `src/shared/` içindeki mantık için `test/` altına test ekle veya güncelle.
5. Commit mesajlarında [Conventional Commits](https://www.conventionalcommits.org/tr/) biçimini kullan: `feat:`, `fix:`, `docs:`, `chore:`, `style:`.
6. `main`'e bir pull request aç ve şablonu doldur.

### Proje yapısı

- `src/content/`: her site için bir içerik scripti (OnePaceTR için `content.js`, `animpow.js`, `tranime.js`) ve gömülü oynatıcılar için `player-frame.js`
- `src/shared/`: içerik scriptlerinin ortak kullandığı, testlerle kapsanan mantık
- `src/background/service-worker.js`: sayfalar ile oynatıcı çerçeveleri arasında mesaj iletir

---

## Español

Gracias por ayudar a mejorar OnePace Utilities.

### Informar de errores e ideas

[Abre un issue](https://github.com/unseensenpai/onepace-utilities/issues/new/choose) y elige el formulario de error o de petición de función. Para los errores, indica el sitio y la URL del episodio, la fuente de vídeo (por ejemplo AitrVip o Sibnet), tu navegador y la versión de la extensión. Las líneas de la consola que empiezan por `[Arc Master]` ayudan mucho.

### Trabajar en el código

1. Haz un fork del repositorio y crea una rama desde `main`, por ejemplo `fix/source-autoselect`.
2. Carga la carpeta con **Cargar descomprimida** en la página de extensiones del navegador y recarga la extensión tras cada cambio.
3. Ejecuta las pruebas con Node.js 22 o posterior:
   ```sh
   npm test
   ```
4. Mantén los cambios acotados y sigue el estilo del código existente. Añade o actualiza pruebas en `test/` para la lógica de `src/shared/`.
5. Usa mensajes con el formato [Conventional Commits](https://www.conventionalcommits.org/es/): `feat:`, `fix:`, `docs:`, `chore:`, `style:`.
6. Abre un pull request hacia `main` y completa la plantilla.

### Estructura del proyecto

- `src/content/`: un script de contenido por sitio (`content.js` para OnePaceTR, `animpow.js`, `tranime.js`) y `player-frame.js` para los reproductores integrados
- `src/shared/`: lógica compartida por los scripts de contenido, cubierta por pruebas
- `src/background/service-worker.js`: reenvía mensajes entre las páginas y los marcos del reproductor
