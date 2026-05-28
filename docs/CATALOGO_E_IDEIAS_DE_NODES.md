# Catálogo de Nodes + Ideias de Expansão

> Documento conceitual (sem código) — pensado pra briefar outra LLM/sistema nodal e mapear o que torna esse tipo de ferramenta um **canivete suíço** para criação de conteúdo em múltiplos nichos.

**Foco:** capacidades, não implementação.

---

## Sumário

- [Parte 1 — O que já temos hoje (27 nodes)](#parte-1--o-que-já-temos-hoje)
- [Parte 2 — Ideias de novos nodes](#parte-2--ideias-de-novos-nodes)
  - [2.1 Data Sources (novas fontes de input)](#21-data-sources-novas-fontes-de-input)
  - [2.2 Transform & Logic (processamento mais rico)](#22-transform--logic-processamento-mais-rico)
  - [2.3 AI Generators (novos tipos de geração)](#23-ai-generators-novos-tipos-de-geração)
  - [2.4 Audio & Voice (categoria inteira nova)](#24-audio--voice-categoria-inteira-nova)
  - [2.5 Composição & Editor avançado](#25-composição--editor-avançado)
  - [2.6 Workflow Control (controle de fluxo de verdade)](#26-workflow-control)
  - [2.7 Outputs / Distribuição](#27-outputs--distribuição)
  - [2.8 Quality, Analytics & Guardrails](#28-quality-analytics--guardrails)
  - [2.9 Utilitários e Meta-nodes](#29-utilitários-e-meta-nodes)
- [Parte 3 — Nichos e workflows que isso desbloqueia](#parte-3--nichos-e-workflows-que-isso-desbloqueia)
- [Parte 4 — Priorização sugerida](#parte-4--priorização-sugerida)

---

## Parte 1 — O que já temos hoje

Os **27 nodes atuais** divididos em 4 categorias.

### 🔵 Input (entrada de dados)

| Node | O que faz |
|---|---|
| **Text** | Caixa de texto multiline. Source de string. |
| **Number** | Emite número com 4 modos: fixed, increment, decrement, random. Crucial pra batch processing (índices únicos por run). |
| **File** | Upload de imagem ou vídeo. Guarda histórico, persiste em Supabase Storage. |
| **Google Sheets** | Importa planilha como array de objetos. Auto-fetch com debounce. CSV publicado ou API. |

### 🟣 Processing (transformação e roteamento)

| Node | O que faz |
|---|---|
| **Table Filter** | Filtra linhas/colunas com sintaxe rica (`1,3,5` / `1-5`). |
| **Get Field** | Extrai campo nomeado de um objeto. Suporta modo dinâmico (campo via input). |
| **List** | Seleciona um item de array. Tem handle `selectedIndex` pra controle externo. |
| **Text Splitter** | Quebra texto por delimitador, retorna array. |
| **Text Concatenator** | Junta N textos com separador customizável (suporta `\n`, `\t`). Inputs dinâmicos. |
| **Text Replace** | Find & replace com regex, case-sensitive opcional, replace all. |
| **Switch/Case** | Lógica condicional declarativa. Match input → output. Default fallback. |
| **Media Switcher** | Escolhe 1 de N imagens/vídeos via dropdown ou índice dinâmico. |
| **Text Iterator** | Quebra texto e passa array inteiro downstream (pra batch). |
| **Image Iterator** | Display em grid de array de imagens. |
| **Iterator** | (legado/vazio, ignorar) |

### 🌸 AI Generators

| Node | O que faz |
|---|---|
| **LLM** | Texto via Gemini. Multimodal (até 5 imagens de ref). System prompt separado. |
| **Universal LLM** | Multi-provider via FAL (GPT, Claude, Llama, Gemini). Reasoning opcional. |
| **Image Generator (Nano Banana — Google)** | Gera imagem via Gemini 2.5 Flash Image. 9 aspects. Batch mode auto se receber array. |
| **Nano Banana FAL** | Mesma capacidade via FAL.ai. |
| **Video Generator (Veo)** | Google Veo 3.1. Modes: text, firstFrame, firstLastFrame, referenceImages. |
| **Kling Video** | Kling 2.5 Pro via FAL. firstFrame ou firstLastFrame. |

### 🟠 Output (composição e saída)

| Node | O que faz |
|---|---|
| **Compositor** | Editor Konva-based com layers (image/video/text), transforms, blend modes, opacity. Auto-detecta canvas size do background. |
| **Advanced Compositor** | Versão anterior, similar mas com diferenças de UX. |
| **Export** | Salva como PNG/JPEG (Konva) ou MP4/WebM (FFmpeg.wasm). |
| **Google Drive Upload** | Sobe arquivos pro Drive (com subpastas). Múltiplos inputs por node. |
| **Google Sheets Write** | Escreve dados de volta em planilha. Modes: append ou update por linha. |

---

## Parte 2 — Ideias de novos nodes

> Cada ideia indica: **o que faz**, **workflow que desbloqueia** e **valor agregado**.

### 2.1 Data Sources (novas fontes de input)

#### **RSS / Atom Feed**
- **O que faz:** Lê feeds RSS, retorna últimas N entradas como array de objetos `{title, summary, link, date, author}`.
- **Workflow:** Monitorar blogs/notícias → resumir com LLM → gerar imagem + caption → postar.
- **Valor:** Automação de curadoria de conteúdo. Newsletter automática. Aggregator de nicho.

#### **Web Scraper (URL + CSS Selector)**
- **O que faz:** Recebe URL e seletor CSS, extrai conteúdo estruturado.
- **Workflow:** Pegar produtos de e-commerce concorrente → reescrever descrição → publicar.
- **Valor:** Acesso a qualquer site sem API. **Coloca uma camada de cuidado ética/legal**, mas o uso valida.

#### **YouTube Trending / Search**
- **O que faz:** Busca vídeos por keyword/canal/trending por região, retorna `{title, thumbnail, description, transcript, views, likes}`.
- **Workflow:** Achar tópicos em alta → gerar thumbnail + título alternativo → testar A/B.
- **Valor:** Inteligência de mercado pra criadores de vídeo.

#### **Reddit / HackerNews / Twitter Scanner**
- **O que faz:** Top posts/threads de um sub/tópico com comentários top.
- **Workflow:** "O que tá pegando em r/cooking?" → LLM identifica tendências → roteiro de vídeo + thumb.
- **Valor:** Trend discovery automatizado.

#### **Stock Asset Search (Unsplash / Pexels / Pixabay)**
- **O que faz:** Busca imagem/vídeo/áudio royalty-free por keyword. Retorna URL.
- **Workflow:** LLM gera keywords → busca stock → usa como base/background no Compositor.
- **Valor:** Fallback quando geração de IA não cabe. Acelera produção.

#### **Notion / Airtable Database**
- **O que faz:** Lê (e idealmente escreve) em base Notion/Airtable.
- **Workflow:** Roadmap de conteúdo no Notion → workflow processa cada item → marca como publicado.
- **Valor:** Integração com ferramentas que produtores de conteúdo já usam.

#### **Webhook Trigger**
- **O que faz:** Expõe URL única que dispara o workflow quando recebe POST.
- **Workflow:** Stripe vende um curso → webhook dispara → gera email personalizado + boas-vindas.
- **Valor:** Torna workflows **reativos a eventos externos**, não só manuais.

#### **Schedule / Cron Trigger**
- **O que faz:** Dispara workflow em horário definido (toda segunda 8h, etc.).
- **Workflow:** Diariamente: pega 3 trending posts → cria carrossel → posta no LinkedIn.
- **Valor:** Automação 24/7 sem precisar abrir navegador.

#### **Email Inbox / IMAP**
- **O que faz:** Lê emails recentes que batem com filtro (assunto, remetente).
- **Workflow:** Cliente manda briefing por email → workflow extrai dados → gera proposta.
- **Valor:** Email continua sendo onde briefings chegam. Capturar isso é ouro.

#### **Generic HTTP / API Caller**
- **O que faz:** GET/POST/PUT/DELETE configurável. Headers, body, parsing JSON.
- **Workflow:** Plugar qualquer API que você ache. CRMs custom, internal tools, etc.
- **Valor:** Escape hatch. Cobre 100% dos casos não cobertos por nodes específicos.

#### **Clipboard / Drop Zone**
- **O que faz:** Aceita arrasto de qualquer coisa (texto, imagem, URL, arquivo).
- **Workflow:** Usuário cola um link → workflow descobre se é YouTube/Twitter/imagem e roteia.
- **Valor:** Reduz fricção massivamente pra workflows interativos.

---

### 2.2 Transform & Logic (processamento mais rico)

#### **JSON Builder / Parser**
- **O que faz:** Builder: monta JSON com slots. Parser: extrai paths via JSONPath/dot notation.
- **Workflow:** Output de LLM em JSON estruturado → parsea campos → distribui pra próximos nodes.
- **Valor:** Trabalhar com LLM em **structured output** vira primeira classe.

#### **Markdown Parser**
- **O que faz:** Quebra markdown em estrutura (headers, listas, code blocks, imagens).
- **Workflow:** LLM escreve artigo em MD → parse → cada seção vira um slide.
- **Valor:** Markdown é o formato natural de LLMs. Operar nele é essencial.

#### **Math / Expression**
- **O que faz:** Avalia expressões com variáveis. `{price} * 1.1` ou `{count} > 100`.
- **Workflow:** Calcular preços com markup, comparar métricas, gerar timestamps.
- **Valor:** Lógica numérica sem precisar plugar LLM (custo zero).

#### **Date/Time Formatter**
- **O que faz:** Manipula datas. Formato, fuso, adicionar/subtrair, "há 3 dias", etc.
- **Workflow:** Schedule posts pra timezone do público, gerar timestamps de YouTube chapters.
- **Valor:** Date math é um inferno comum. Centralizar resolve.

#### **Translator (DeepL / GPT)**
- **O que faz:** Traduz texto entre idiomas com preservação de tom.
- **Workflow:** Criar conteúdo em inglês → traduzir pra 5 idiomas → postar localizado.
- **Valor:** Multilíngue desde o primeiro workflow. Mercado enorme.

#### **Sentiment / Emotion Analyzer**
- **O que faz:** Classifica texto: sentimento, emoção, urgência, sarcasmo.
- **Workflow:** Comentários de clientes → filtra negativos → gera resposta personalizada.
- **Valor:** Triagem automática. Customer success.

#### **Keyword / Entity Extractor**
- **O que faz:** Extrai pessoas, lugares, marcas, tópicos de um texto.
- **Workflow:** Artigo → entidades → busca imagens dessas entidades → ilustra automaticamente.
- **Valor:** Conecta textos a outros recursos sem hardcoding.

#### **Summarizer (multi-estratégia)**
- **O que faz:** Resume em N palavras, em bullets, em ELI5, em formato Twitter, etc.
- **Workflow:** Vídeo longo → transcrição → resumo executivo + thread de Twitter + caption pra Insta.
- **Valor:** Um node, N saídas otimizadas. Reuso de conteúdo.

#### **Regex Capture**
- **O que faz:** Extrai capture groups via regex nomeado. Output structured.
- **Workflow:** Parsear preços, datas, IDs, emails de textos não estruturados.
- **Valor:** Quando LLM é overkill.

#### **Array Operations** (sort/filter/map/reduce/groupBy/unique/limit)
- **O que faz:** Família de nodes pra manipular arrays sem precisar de código.
- **Workflow:** Pegar 100 produtos → filtra por categoria → ordena por preço → pega top 10.
- **Valor:** Substituir "tabela filter" por algo composable e mais expressivo.

#### **For Each Loop**
- **O que faz:** Itera de verdade — pra cada item de array, roda sub-workflow com aquele item como contexto.
- **Workflow:** 50 linhas de planilha → pra cada → gera imagem + posta → próxima.
- **Valor:** **CRÍTICO.** Hoje a gente improvisa isso com queue + Number. Loop real é mais limpo.

#### **Conditional Branching (If / Else / Switch)**
- **O que faz:** Splita o flow em N caminhos baseado em condição. Cada caminho pode ter nodes diferentes.
- **Workflow:** SE language == "pt", roda LLM com prompt PT; SENÃO usa EN.
- **Valor:** Workflows complexos sem precisar criar 5 cópias do pipeline.

#### **Variable / Global State**
- **O que faz:** Set/Get variável nomeada que persiste durante o workflow.
- **Workflow:** Acumular custo total, contar items processados, guardar estado entre iterações.
- **Valor:** Estado compartilhado sem precisar passar tudo via edges.

#### **Wait / Delay**
- **O que faz:** Pausa N segundos antes do próximo node.
- **Workflow:** Rate limiting manual. Espera vídeo renderizar. Throttle posts pra rede social.
- **Valor:** Controle fino sobre timing.

#### **Try / Catch (Error Handler)**
- **O que faz:** Empacota nodes em "tentativa". Se falhar, roteia pra path alternativo.
- **Workflow:** Tenta gerar com Veo. Se falhar, tenta Kling. Se falhar de novo, manda alerta.
- **Valor:** Resiliência. Workflows de produção precisam disso.

#### **Approval Gate / Human in the Loop**
- **O que faz:** Pausa workflow e manda notificação. Usuário aprova/rejeita/edita. Workflow continua.
- **Workflow:** Gera 10 posts → notifica via Telegram → você aprova pelos thumbs → posta os aprovados.
- **Valor:** Controle de qualidade em scale. **Killer feature.**

---

### 2.3 AI Generators (novos tipos de geração)

#### **Image Upscaler**
- **O que faz:** Aumenta resolução de imagem (2x, 4x) via Real-ESRGAN, Topaz, etc.
- **Workflow:** Imagem gerada em 1024 → upscale pra 4096 → uso em print/anúncios.

#### **Background Remover**
- **O que faz:** Remove fundo. Saída PNG transparente.
- **Workflow:** Foto de produto → remove BG → adiciona BG novo via Compositor.
- **Valor:** Produção de e-commerce em escala.

#### **Object Remover / Inpainting**
- **O que faz:** Apaga objetos ou regenera regiões mascaradas.
- **Workflow:** Stock photo perfeita mas tem logo de marca → remove logo → usa.

#### **Image Variation**
- **O que faz:** Gera N variações similares mas diferentes de uma imagem.
- **Workflow:** Hero shot → 10 variações → escolhe melhor → publica.

#### **Style Transfer**
- **O que faz:** Aplica estilo de uma imagem em outra (fotorrealista → cartoon, etc.).
- **Workflow:** Foto do produto → aplica estilo da marca → consistência visual.

#### **Caption Generator (Image → Text)**
- **O que faz:** Descreve uma imagem em texto. Reverse direction.
- **Workflow:** Auto alt-text. SEO de imagens. Extração de info de screenshots.

#### **Color Palette Extractor**
- **O que faz:** Extrai paleta dominante de uma imagem.
- **Workflow:** Branding consistente. Cores de UI baseadas em hero image.

#### **3D Model Generator**
- **O que faz:** Texto/imagem → modelo 3D (Tripo, Hyper3D, Meshy).
- **Workflow:** Briefing de produto → 3D model → renders em N ângulos → catálogo.
- **Valor:** Abre nichos de games, AR/VR, produto.

#### **Avatar / Talking Head (HeyGen, Synthesia)**
- **O que faz:** Texto + avatar → vídeo de pessoa falando.
- **Workflow:** Newsletter em texto → avatar lendo → vídeo pra YouTube/TikTok.
- **Valor:** Multiplica formato sem precisar gravar.

#### **Lip Sync**
- **O que faz:** Recebe vídeo de pessoa + áudio → sincroniza lábios ao áudio.
- **Workflow:** Vídeo em PT → áudio dublado em EN → lip sync → versão em inglês.
- **Valor:** Localização de vídeo automatizada.

---

### 2.4 Audio & Voice (categoria inteira nova)

Hoje a gente não tem áudio. **Isso é uma lacuna gigante.**

#### **Text-to-Speech (ElevenLabs, OpenAI TTS, Azure)**
- **O que faz:** Texto → áudio de voz. Múltiplas vozes, idiomas, emoção.
- **Workflow:** Script de vídeo → narração → mistura com música.

#### **Voice Cloner**
- **O que faz:** Amostra de voz + texto → áudio na voz clonada.
- **Workflow:** Criador grava 30s → todos próximos vídeos usam voz dele sem regravar.
- **Valor:** Personalidade consistente sem trabalho. **Cuidado ético.**

#### **Speech-to-Text (Whisper, AssemblyAI)**
- **O que faz:** Áudio/vídeo → transcrição com timestamps.
- **Workflow:** Vídeo de podcast → transcript → resumo → show notes → redes sociais.

#### **Music Generator (Suno, Udio, MusicGen)**
- **O que faz:** Prompt → música original. Estilo, duração, instrumental ou com letra.
- **Workflow:** Briefing de marca → trilha sonora própria → background de vídeos.

#### **Sound Effects Generator (ElevenLabs SFX)**
- **O que faz:** "Som de chuva forte" → arquivo de áudio.
- **Workflow:** Vídeo com cenas → gera SFX correspondentes → mixa.

#### **Audio Mixer / Multi-track**
- **O que faz:** Mixa N tracks de áudio (música, voz, SFX) com volume, fade, pan.
- **Workflow:** Voz + música de fundo + SFX → arquivo final mixado.

#### **Audio Cleaner / Normalizer**
- **O que faz:** Remove ruído, normaliza volume, equaliza.
- **Workflow:** Gravação caseira → limpa → soa profissional.

#### **Subtitle Generator (auto-translate)**
- **O que faz:** Áudio → SRT com timestamps. Opcionalmente traduz pra N idiomas.
- **Workflow:** Vídeo → subs em 5 idiomas → versões localizadas.

---

### 2.5 Composição & Editor avançado

Nosso Compositor é bom, mas tem espaço pra expansão massiva.

#### **Animation / Timeline Track**
- **O que faz:** Camada animada — keyframes de posição, escala, opacidade ao longo do tempo.
- **Workflow:** Logo entra deslizando, texto fade in, transição entre cenas.
- **Valor:** Sai de "imagem composta" pra "vídeo motion graphics".

#### **Multi-Scene Timeline**
- **O que faz:** Sequência de cenas (cada uma é uma composição) com transições.
- **Workflow:** Vídeo de 60s com 6 cenas de 10s, transição cross-fade entre elas.
- **Valor:** Permite vídeos editorial completos.

#### **Transition Library**
- **O que faz:** Cross-fade, wipe, slide, zoom, glitch, etc. entre cenas.
- **Workflow:** Estilo profissional sem editor de vídeo separado.

#### **Lottie / SVG Animation Player**
- **O que faz:** Adiciona animação Lottie como layer.
- **Workflow:** Logo animado, ícones, illustrations animadas dentro do vídeo.

#### **Mask / Crop Layer**
- **O que faz:** Define forma (círculo, retângulo, custom shape, polygon) que recorta layer.
- **Workflow:** Avatar redondo, picture-in-picture, splits criativos.

#### **Filter / Color Grading / LUT**
- **O que faz:** Aplica filtros (Instagram-style) ou LUTs profissionais.
- **Workflow:** Manter look consistente em todos os assets de uma campanha.

#### **Watermark / Brand Layer (auto-positioning)**
- **O que faz:** Adiciona logo/watermark com regras (top-right, com padding, opacidade).
- **Workflow:** Proteção de IP automática em todos exports.

#### **Subtitle Burner**
- **O que faz:** Queima legendas no vídeo (estilo TikTok com word-by-word highlight).
- **Workflow:** Vídeo + SRT → vídeo com legendas estilizadas burnidas.

#### **Particle Effects**
- **O que faz:** Confetti, neve, fagulhas, fumaça como layer.
- **Workflow:** Celebração, atmosfera, momentos enfáticos.

#### **Text-to-Motion**
- **O que faz:** Texto animado (typewriter, slide-in, bounce, glitch).
- **Workflow:** Títulos chamativos sem After Effects.

#### **Video Trimmer / Cutter**
- **O que faz:** Corta vídeo em start/end timestamps. Múltiplos cortes podem virar reel.
- **Workflow:** Vídeo longo → top 5 melhores momentos → reel.

#### **Speed Ramping**
- **O que faz:** Slow-mo, fast-forward, freeze frame.
- **Workflow:** Hook dramático em 2s, depois fast-forward do tutorial.

---

### 2.6 Workflow Control

#### **Sub-workflow / Composable**
- **O que faz:** Embute outro workflow como um node. Reuso.
- **Workflow:** Workflow "gera reel completo" usado dentro de workflow maior "campanha de lançamento".
- **Valor:** **Modularidade.** Workflows complexos viáveis.

#### **Parallel Split / Merge**
- **O que faz:** Splita execução pra N caminhos paralelos, depois merge com agregação.
- **Workflow:** Mesmo input vira post pra Insta + Tweet + LinkedIn em paralelo, depois agrega resultados.

#### **Retry Wrapper**
- **O que faz:** Embute node em retry policy (N tentativas, backoff, conditions).
- **Workflow:** Geração de imagem falha às vezes → wrapper garante eventual sucesso.

#### **Cache / Memoize**
- **O que faz:** Guarda resultado por hash de input. Próxima vez retorna cached.
- **Workflow:** Re-executar workflow mil vezes em dev sem pagar API toda hora.

#### **Rate Limiter**
- **O que faz:** Limita N execuções por janela de tempo. Enfileira excedentes.
- **Workflow:** API com 60 req/min → respeitar.

---

### 2.7 Outputs / Distribuição

Hoje só temos Drive e Sheets. Distribuição direta pra plataformas é game-changer.

#### **Instagram Publisher (post / reel / story / carousel)**
- **O que faz:** Posta diretamente. Caption, hashtags, agendamento.
- **Workflow:** Gera conteúdo → posta. Zero etapa manual.

#### **TikTok Publisher**
- Mesma ideia. Inclui hashtags trending e music match.

#### **YouTube Publisher**
- Vídeo, thumb, título, descrição, tags, chapters, end screen.

#### **Twitter/X Publisher**
- Tweet único, thread, com mídia, scheduled.

#### **LinkedIn Publisher**
- Texto + carrossel PDF, vídeo, agendamento.

#### **Discord / Slack / Telegram Webhook**
- **O que faz:** Notifica canal interno com texto + mídia.
- **Workflow:** Workflow terminou → mensagem no Discord da equipe com preview.

#### **Email Sender**
- **O que faz:** Envia email via SMTP/Resend/SendGrid. Templates, attachments.
- **Workflow:** Gera proposta → envia pra cliente direto.

#### **PDF Generator**
- **O que faz:** Compõe PDF de N páginas. Templates, imagens, texto formatado.
- **Workflow:** Briefing → estudo de caso → PDF profissional.

#### **WordPress / Ghost / Substack Publisher**
- **O que faz:** Cria/atualiza post. Featured image, tags, categorias.
- **Workflow:** LLM escreve artigo → publica direto no blog.

#### **Shopify / WooCommerce Product Updater**
- **O que faz:** Cria/atualiza produto. Descrição, imagens, preço, variantes.
- **Workflow:** Planilha de novos produtos → cadastra todos em lote.

#### **Notion / Airtable Writer**
- **O que faz:** Cria/atualiza pages/records.
- **Workflow:** Fecha o loop: lê do Notion, processa, escreve resultado de volta.

#### **S3 / R2 / Cloudflare Storage**
- **O que faz:** Upload arquivos pra storage object.
- **Workflow:** Backup automático de gerações. CDN pra delivery rápido.

#### **Calendar Event Creator**
- **O que faz:** Cria evento em Google Calendar com data, descrição, attendees.
- **Workflow:** Gera content calendar → cria todos eventos automaticamente.

---

### 2.8 Quality, Analytics & Guardrails

Categoria que ninguém pensa mas que **diferencia ferramentas profissionais.**

#### **Brand Voice Checker**
- **O que faz:** Compara texto contra style guide da marca (formal/casual, evita "X", usa "Y").
- **Workflow:** LLM gera → checker valida → se desvia, regenera.
- **Valor:** Consistência editorial em escala.

#### **Safety / NSFW Check**
- **O que faz:** Avalia se conteúdo é seguro pra marca/plataforma. Score 0-1.
- **Workflow:** Gate antes de publicar. Evita PR disaster.

#### **Fact Checker**
- **O que faz:** Identifica claims, busca evidência, reporta confiança.
- **Workflow:** Reduz hallucination de LLM em conteúdo educacional/jornalístico.

#### **Engagement Predictor**
- **O que faz:** Estima provável engagement de um post (mock, baseado em padrões históricos).
- **Workflow:** A/B test de 10 captions → pega top 3 → testa em produção.

#### **Readability Score**
- **O que faz:** Calcula Flesch/Kincaid/etc. Reading level.
- **Workflow:** Conteúdo educacional ajustado pra audiência (ex.: 6th grade).

#### **Plagiarism / Originality Check**
- **O que faz:** Compara contra web ou bases conhecidas.
- **Workflow:** Garantir conteúdo único pra SEO.

#### **Token Counter / Cost Estimator**
- **O que faz:** Conta tokens, estima custo antes de executar.
- **Workflow:** Dev mode — saber quanto vai custar antes de rodar batch grande.

#### **Visual A/B Test Runner**
- **O que faz:** Gera N variações e roda teste estatístico via API de analytics.
- **Workflow:** Testar 5 thumbs no YouTube → escolhe melhor automaticamente.

---

### 2.9 Utilitários e Meta-nodes

#### **Note / Comment**
- **O que faz:** Apenas documentação visual. Não executa.
- **Valor:** Workflows complexos viram **legíveis** pra outras pessoas.

#### **Group / Container**
- **O que faz:** Agrupa N nodes visualmente. Pode bypassar/executar em bloco.
- **Valor:** Organização. Workflow gigante sem virar spaghetti.

#### **Environment Variable / Secret**
- **O que faz:** Variável criptografada (API keys, etc.) referenciável.
- **Valor:** Segurança. Compartilhar workflow sem leak.

#### **Webhook Listener (in)**
- Já mencionado em data sources. Mas pode ter variação: **resposta síncrona** pra ser API.

#### **Workflow Variable / Form Input**
- **O que faz:** Define input parametrizado do workflow. Quando alguém roda, preenche.
- **Workflow:** Workflow "gera reel" pede `tema`, `público-alvo`, `idioma`. Roda sob demanda.
- **Valor:** Transforma workflow em **app** reutilizável.

#### **Random Picker**
- **O que faz:** Escolhe 1 de N opções aleatoriamente (com pesos opcionais).
- **Workflow:** Variação de prompts pra evitar conteúdo repetitivo.

#### **Counter / Accumulator**
- **O que faz:** Conta execuções, soma valores, etc. Persiste entre runs.
- **Workflow:** "Esse é o post #47 da série".

---

## Parte 3 — Nichos e workflows que isso desbloqueia

Aqui mostro **workflows completos** por nicho. Cada um combina nodes existentes + novos.

### 🛍️ E-commerce

**Workflow: Cadastro de produto em lote**
```
Google Sheets (lista de produtos)
  → For Each Loop
    → Get Field (nome, categoria, atributos)
    → LLM (gera descrição SEO-otimizada com tom da marca)
    → Brand Voice Checker (valida tom)
    → Image Generator (foto hero baseada em atributos)
    → Image Variation (4 ângulos)
    → Background Remover (cada variação)
    → Compositor (adiciona BG de catálogo + watermark)
    → Shopify Publisher (cria produto)
    → Google Sheets Write (marca como publicado)
```

**Novo possível:** "Pricing Optimizer" que sugere preço baseado em concorrência.

---

### 🎓 Educação / Cursos

**Workflow: Curso completo a partir de tópico**
```
Text (tópico do curso)
  → LLM (gera syllabus em 10 lições)
  → JSON Parser (extrai cada lição)
  → For Each Lição
    → LLM (escreve roteiro)
    → Speech-to-Text style → TTS (narração)
    → Image Generator (visual da lição)
    → Compositor (visual + texto-resumo)
    → Multi-Scene Timeline (intro + visuais + outro)
    → Export (vídeo)
    → Quiz Generator (5 perguntas)
    → PDF Generator (apostila da lição)
    → Notion Writer (cria página do módulo)
```

**Nodes novos críticos:** Quiz Generator, PDF Generator, TTS.

---

### 📰 Newsletter / Curadoria

**Workflow: Newsletter semanal automatizada**
```
Cron Trigger (toda sexta 8h)
  → RSS Feed (5 fontes do nicho) [paralelo]
    Reddit Scanner (top da semana de r/X)
    Twitter (trending de hashtags)
  → Merge / Dedup
  → LLM (rankeia top 10 stories por relevância)
  → For Each Story
    → LLM (resume em 50 palavras)
    → Image Generator (visual editorial)
  → Compositor (newsletter layout)
  → PDF Generator (versão completa)
  → Email Sender (manda pra base via Mailchimp)
  → Twitter Publisher (thread com top 3)
```

---

### 🎬 Criadores de vídeo (YouTube/TikTok/Reels)

**Workflow: Pipeline de Reels diários**
```
Trending Scanner (TikTok top 100 do nicho)
  → For Each Top 10
    → LLM (cria "ângulo único" sobre o tema)
    → Script Writer (LLM, formato hook + body + CTA)
    → TTS / Voice Clone (narração)
    → Image Generator (3 visuais)
    → Video Generator (cinemágrafo curto)
    → Music Generator (trilha 30s)
    → Audio Mixer (voz + música)
    → Subtitle Generator (com timestamps)
    → Compositor + Subtitle Burner (vídeo final)
    → Multi-Scene Timeline (hook 3s + body + CTA)
    → Approval Gate (envia preview pro Telegram)
    → [se aprovado] TikTok Publisher + Instagram Reel Publisher
```

**Nodes críticos:** TTS, Music Gen, Audio Mixer, Subtitle Burner, Approval Gate.

---

### 🏠 Imobiliário

**Workflow: Anúncio de imóvel a partir de fotos**
```
File (upload 10 fotos do imóvel)
  → For Each Foto
    → Image Quality Enhancer
    → Caption Generator (descreve o que tem)
  → Summarizer (consolida em "casa de 3 quartos com vista...")
  → LLM (escreve anúncio persuasivo)
  → Translator (pt + en + es)
  → Compositor (cria carrossel "antes/depois" com tour)
  → Music Generator (trilha tranquila)
  → Multi-Scene Timeline (vídeo de 30s do tour)
  → Instagram Carousel Publisher
  → Email Sender (manda pra lista de leads)
```

---

### 🎵 Podcast / Áudio

**Workflow: Episódio + distribuição multiformato**
```
File (gravação .mp3)
  → Audio Cleaner (remove ruído)
  → Speech-to-Text (transcript com timestamps)
  → LLM (identifica capítulos)
  → Summarizer (show notes em markdown)
  → LLM (extrai 3 "audiogram moments" pra clipes)
  → For Each Moment
    → Video Trimmer (recorta áudio)
    → Compositor (audiograma com waveform + caption)
    → Twitter Publisher (clip + quote)
    → Instagram Reel Publisher
  → PDF Generator (transcript completo)
  → WordPress Publisher (post com show notes + embed)
  → YouTube Publisher (versão vídeo com waveform)
```

---

### 🏷️ Marca / Branding

**Workflow: Brand kit completo a partir de briefing**
```
Form Input (nome, valores, público, tom desejado)
  → LLM (gera personalidade da marca)
  → LLM (paleta de cores justificada) → Color Palette Visualizer
  → Image Generator (logo em 5 estilos)
  → Approval Gate (escolhe favorito)
  → Image Variation (variações horizontal/vertical/só ícone)
  → LLM (style guide de voz: do's e dont's)
  → LLM (50 caption templates)
  → Compositor (mockups: card, post, banner, story)
  → PDF Generator (brand kit completo)
  → Google Drive Upload (organizado em pastas)
```

---

### 🍔 Restaurante / Local Business

**Workflow: Cardápio semanal nas redes**
```
Notion Database (cardápio da semana)
  → For Each Prato
    → File (foto enviada pelo chef) OR Image Generator (se não tiver)
    → Image Quality Enhancer
    → LLM (descrição apetitosa + emoji)
    → Translator (pt-en pra turistas)
    → Compositor (template do restaurante + nome + preço)
    → Instagram Publisher (agendado pra horário pico)
    → Google Business Update (foto + descrição)
```

---

### 🎮 Indie Game Dev

**Workflow: Asset pack pra game**
```
Text (descrição do mundo do jogo)
  → LLM (extrai N entidades: personagens, items, cenários)
  → For Each Entidade
    → Image Generator (concept art)
    → Image Variation (4 ângulos)
    → 3D Model Generator (asset 3D)
    → Background Remover (sprite versão)
  → Music Generator (trilha do mundo)
  → Sound Effects Generator (SFX list: passos, ataque, UI)
  → S3 Upload (pasta organizada do projeto)
```

---

## Parte 4 — Priorização sugerida

Se você for criar do zero, considere essa ordem (impacto × esforço):

### 🔥 Wave 1 — Foundations (já temos análogos, refinar)
1. Text, Number, File, Sheets (inputs básicos)
2. LLM + Image Gen + Video Gen (geradores essenciais)
3. Text Splitter, Concatenator, Replace, List (transformações básicas)
4. Compositor + Export (composição visual)
5. **Variable / Global State** (faltava aqui também)
6. **For Each Loop** (substituir nossa improvisação com queue)
7. **Conditional Branching** (vital pra workflows reais)

### 🚀 Wave 2 — Diferenciação imediata
8. **TTS + Audio Mixer** (abre toda categoria de áudio)
9. **Cron Trigger + Webhook Trigger** (workflows reativos)
10. **Sub-workflow** (modularidade)
11. **Approval Gate** (human-in-the-loop)
12. **Subtitle Generator + Burner** (videos multi-idioma)
13. **RSS + Web Scraper** (input do mundo real)
14. **Instagram + TikTok + YouTube Publishers** (fecha o loop)

### 🎨 Wave 3 — Editor avançado
15. **Multi-Scene Timeline** (vídeos editorial)
16. **Animation/Keyframes** (motion graphics)
17. **Transition Library**
18. **Mask/Crop layer**
19. **Music Generator** (trilha original)
20. **Voice Clone** (personalidade consistente)

### 🛡️ Wave 4 — Production grade
21. **Brand Voice Checker**
22. **Safety/NSFW Check**
23. **Try/Catch + Retry Wrapper**
24. **Cache/Memoize**
25. **Rate Limiter**
26. **Cost Estimator**
27. **Approval Gate** (revisita com mais features)

### 🌍 Wave 5 — Ecosystem (abre nichos)
28. **3D Model Generator**
29. **Avatar/Talking Head**
30. **Lip Sync**
31. **PDF Generator**
32. **Notion/Airtable bidirecional**
33. **Shopify/WordPress publishers**
34. **Form Input** (transforma workflows em apps)

---

## Anexo — Princípios de Design pra novos nodes

Pra qualquer novo node que sua LLM proponha, valide com esses critérios:

1. **Faz uma coisa só, bem.** Se o nome tem "e" ("Image Generator and Uploader"), divide.
2. **Inputs e outputs com tipos claros.** Se aceita "qualquer coisa", repensa.
3. **Tem use case real em algum dos workflows acima?** Se não tem, não cria.
4. **É **composável** com outros nodes existentes?** Se exige outros 3 nodes específicos pra funcionar, talvez seja parte de um maior.
5. **Reusa nodes existentes ao invés de duplicar lógica?** (Ex.: não cria "Tweet Image Generator" — usa Image Generator + Tweet Publisher.)
6. **Documenta com 1 frase + 1 exemplo de workflow.** Se não conseguir, ainda não tá claro.

---

## TL;DR

**O que já temos** = ferramentas pra **gerar e compor** conteúdo a partir de **dados estruturados** (planilhas).

**O que falta pra ser canivete suíço de verdade:**

1. **Áudio** (categoria inteira: TTS, música, SFX, mixer)
2. **Triggers reativos** (cron, webhook, email, file watch)
3. **Distribuição direta** (publishers pra cada plataforma)
4. **Controle de fluxo real** (loop, if/else, sub-workflow, try/catch)
5. **Human-in-the-loop** (approval gates)
6. **Editor avançado** (animação, timeline multi-cena, transições)
7. **Inputs do mundo real** (RSS, scraper, trending scanners)
8. **Quality guardrails** (brand voice, safety, fact check)
9. **Form Input** (transforma workflows em apps reutilizáveis)

Implementando esses, a ferramenta deixa de ser "editor de fluxo" e vira **plataforma de produção de conteúdo end-to-end multi-formato multi-canal**. Pra qualquer nicho.

Boa sorte. 💪
