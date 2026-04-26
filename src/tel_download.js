// ==UserScript==
// @name         Telegram Media Downloader (Custom)
// @version      1.212-custom-1
// @namespace    https://github.com/Neet-Nestor/Telegram-Media-Downloader
// @description  원본: Nestor Qin / 수정: 선택 다운로드, 재시도 강화, 셀렉터 정리
// @author       Nestor Qin (modified)
// @license      GNU GPLv3
// @match        https://web.telegram.org/*
// @match        https://webk.telegram.org/*
// @match        https://webz.telegram.org/*
// @icon         https://img.icons8.com/color/452/telegram-app--v5.png
// ==/UserScript==


(function () {
  "use strict";

  // ==========================================================================
  // [개선 1] 셀렉터 한 곳에 모으기
  // --------------------------------------------------------------------------
  // Telegram 웹앱이 업데이트되면 클래스 이름이 바뀌어서 스크립트가 깨짐.
  // 그럴 때 이 SELECTORS 객체만 수정하면 됨. 코드 전체를 뒤질 필요 없음.
  // ==========================================================================
  const SELECTORS = {
    // ─── WebZ (/a/) 버전 ───
    webz: {
      storiesContainer: "#StoryViewer",
      storyImageInViewer: "img.PVZ8TOWS",
      storyHeaderPrimary: ".GrsJNw3y",
      storyHeaderFallback: ".DropdownMenu",
      mediaContainer: "#MediaViewer .MediaViewerSlide--active",
      mediaViewerActions: "#MediaViewer .MediaViewerActions",
      videoPlayer: ".MediaViewerContent > .VideoPlayer",
      imageInViewer: ".MediaViewerContent > div > img",
      videoControls: ".VideoPlayerControls",
      videoControlsButtons: ".buttons",
      videoControlsSpacer: ".spacer",
      // 채팅 메시지 (선택 모드용)
      messageList: ".messages-container, .MessageList",
      mediaMessage: ".Message .media-inner, .Message .photo, .Message .video",
    },
    // ─── WebK (/k/) 버전 ───
    webk: {
      pinnedAudio: ".pinned-audio",
      pinnedAudioUtils: ".pinned-container-wrapper-utils",
      audioElement: "audio-element",
      bubble: ".bubble",
      storiesContainer: "#stories-viewer",
      storyVideo: "video.media-video",
      storyImage: "img.media-photo",
      storyHeader: "[class^='_ViewerStoryHeaderRight']",
      storyFooter: "[class^='_ViewerStoryFooterRight']",
      mediaContainer: ".media-viewer-whole",
      mediaAspecter: ".media-viewer-movers .media-viewer-aspecter",
      mediaButtons: ".media-viewer-topbar .media-viewer-buttons",
      hiddenButton: "button.btn-icon.hide",
      videoPlayer: ".ckin__player",
      videoControls: ".default__controls.ckin__controls",
      videoRightControls: ".bottom-controls .right-controls",
      thumbnailImage: "img.thumbnail",
      // 채팅 메시지 (선택 모드용)
      messageList: ".bubbles, .chat-input + .bubbles-inner",
      mediaMessage: ".bubble.is-out, .bubble.channel-post, .bubble", // 모든 메시지 버블
    },
    // 다크모드 감지
    htmlDarkClasses: ["night", "theme-dark"],
  };

  // ==========================================================================
  // 설정값 (마음대로 바꿔도 됨)
  // ==========================================================================
  const CONFIG = {
    REFRESH_DELAY: 500,           // 미디어 뷰어 감시 주기 (ms)
    MAX_RETRIES: 3,               // [개선 3] 청크 다운로드 실패 시 재시도 횟수
    RETRY_BASE_DELAY: 1000,       // [개선 3] 첫 재시도 대기 시간 (ms). 이후 2배씩 증가 (1s → 2s → 4s)
    SELECT_MODE_DELAY: 2000,      // [개선 2] 선택 다운로드 시 항목 간 대기 시간 (ms)
    MEDIA_VIEWER_TIMEOUT: 8000,   // [개선 2] 미리보기 열림 대기 최대 시간 (ms)
    DEBUG: false,                 // true로 하면 콘솔 로그가 더 자세해짐
  };

  // ==========================================================================
  // 로거
  // ==========================================================================
  const logger = {
    info: (message, fileName = null) => {
      console.log(
        `[Tel Download] ${fileName ? `${fileName}: ` : ""}${message}`
      );
    },
    error: (message, fileName = null) => {
      console.error(
        `[Tel Download] ${fileName ? `${fileName}: ` : ""}${message}`
      );
    },
    debug: (message, fileName = null) => {
      if (CONFIG.DEBUG) {
        console.log(
          `[Tel Download DEBUG] ${fileName ? `${fileName}: ` : ""}${message}`
        );
      }
    },
  };

  // 아이콘 유니코드 (WebK용)
  const DOWNLOAD_ICON = "\ue979";
  const FORWARD_ICON = "\ue99a";
  const contentRangeRegex = /^bytes (\d+)-(\d+)\/(\d+)$/;

  const hashCode = (s) => {
    var h = 0, l = s.length, i = 0;
    if (l > 0) while (i < l) h = ((h << 5) - h + s.charCodeAt(i++)) | 0;
    return h >>> 0;
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const isDarkMode = () => {
    const html = document.querySelector("html");
    return SELECTORS.htmlDarkClasses.some((cls) => html.classList.contains(cls));
  };

  // ==========================================================================
  // 진행률 바 (원본과 거의 동일, 일부 정리)
  // ==========================================================================
  const createProgressBar = (videoId, fileName) => {
    const dark = isDarkMode();
    const container = document.getElementById("tel-downloader-progress-bar-container");
    if (!container) return;

    const innerContainer = document.createElement("div");
    innerContainer.id = "tel-downloader-progress-" + videoId;
    innerContainer.style.cssText = `
      width: 20rem;
      margin-top: 0.4rem;
      padding: 0.6rem;
      background-color: ${dark ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.6)"};
    `;

    const flexContainer = document.createElement("div");
    flexContainer.style.cssText = "display: flex; justify-content: space-between;";

    const title = document.createElement("p");
    title.className = "filename";
    title.style.cssText = "margin: 0; color: white; word-break: break-all;";
    title.innerText = fileName || "(loading...)";

    const closeButton = document.createElement("div");
    closeButton.style.cssText = `cursor: pointer; font-size: 1.2rem; color: ${dark ? "#8a8a8a" : "white"};`;
    closeButton.innerHTML = "&times;";
    closeButton.onclick = () => container.removeChild(innerContainer);

    const progressBar = document.createElement("div");
    progressBar.className = "progress";
    progressBar.style.cssText = `
      background-color: #e2e2e2;
      position: relative;
      width: 100%;
      height: 1.6rem;
      border-radius: 2rem;
      overflow: hidden;
      margin-top: 0.3rem;
    `;

    const counter = document.createElement("p");
    counter.style.cssText = `
      position: absolute; z-index: 5;
      left: 50%; top: 50%;
      transform: translate(-50%, -50%);
      margin: 0; color: black;
    `;
    const progress = document.createElement("div");
    progress.style.cssText = `
      position: absolute; height: 100%; width: 0%;
      background-color: #6093B5;
    `;

    progressBar.appendChild(counter);
    progressBar.appendChild(progress);
    flexContainer.appendChild(title);
    flexContainer.appendChild(closeButton);
    innerContainer.appendChild(flexContainer);
    innerContainer.appendChild(progressBar);
    container.appendChild(innerContainer);
  };

  const updateProgress = (videoId, fileName, progress) => {
    const innerContainer = document.getElementById("tel-downloader-progress-" + videoId);
    if (!innerContainer) return;
    if (fileName) innerContainer.querySelector("p.filename").innerText = fileName;
    const progressBar = innerContainer.querySelector("div.progress");
    progressBar.querySelector("p").innerText = progress + "%";
    progressBar.querySelector("div").style.width = progress + "%";
  };

  const completeProgress = (videoId) => {
    const elem = document.getElementById("tel-downloader-progress-" + videoId);
    if (!elem) return;
    const progressBar = elem.querySelector("div.progress");
    progressBar.querySelector("p").innerText = "Completed";
    progressBar.querySelector("div").style.backgroundColor = "#B6C649";
    progressBar.querySelector("div").style.width = "100%";
  };

  const AbortProgress = (videoId) => {
    const elem = document.getElementById("tel-downloader-progress-" + videoId);
    if (!elem) return;
    const progressBar = elem.querySelector("div.progress");
    progressBar.querySelector("p").innerText = "Aborted";
    progressBar.querySelector("div").style.backgroundColor = "#D16666";
    progressBar.querySelector("div").style.width = "100%";
  };

  // ==========================================================================
  // [개선 3] 재시도 로직이 들어간 청크 fetch
  // --------------------------------------------------------------------------
  // 네트워크가 잠깐 끊기거나 서버가 잠깐 느려져도 처음부터 다시 받지 않고,
  // 그 청크만 1초 → 2초 → 4초 간격으로 최대 3번 재시도.
  // ==========================================================================
  const fetchChunkWithRetry = async (url, offset, fileName) => {
    let lastError = null;
    for (let attempt = 0; attempt < CONFIG.MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url, {
          method: "GET",
          headers: { Range: `bytes=${offset}-` },
        });
        if (![200, 206].includes(res.status)) {
          throw new Error(`Non 200/206 response: ${res.status}`);
        }
        return res;
      } catch (err) {
        lastError = err;
        const delay = CONFIG.RETRY_BASE_DELAY * Math.pow(2, attempt);
        logger.error(
          `Fetch failed (attempt ${attempt + 1}/${CONFIG.MAX_RETRIES}): ${err.message}. Retry in ${delay}ms`,
          fileName
        );
        if (attempt < CONFIG.MAX_RETRIES - 1) await sleep(delay);
      }
    }
    throw lastError;
  };

  // ==========================================================================
  // 비디오 다운로드 (원본 + 재시도 로직)
  // ==========================================================================
  const tel_download_video = (url) => {
    let _blobs = [];
    let _next_offset = 0;
    let _total_size = null;
    let _file_extension = "mp4";

    const videoId =
      (Math.random() + 1).toString(36).substring(2, 10) +
      "_" +
      Date.now().toString();
    let fileName = hashCode(url).toString(36) + "." + _file_extension;

    // stream/{...} 형식 URL에서 fileName 추출 시도
    try {
      const metadata = JSON.parse(
        decodeURIComponent(url.split("/")[url.split("/").length - 1])
      );
      if (metadata.fileName) fileName = metadata.fileName;
    } catch (e) { /* 무시 */ }
    logger.info(`URL: ${url}`, fileName);

    const fetchNextPart = async (_writable) => {
      try {
        // [개선 3] 재시도 포함된 fetch
        const res = await fetchChunkWithRetry(url, _next_offset, fileName);

        const mime = res.headers.get("Content-Type").split(";")[0];
        if (!mime.startsWith("video/")) {
          throw new Error("Get non video response with MIME type " + mime);
        }
        _file_extension = mime.split("/")[1];
        fileName = fileName.substring(0, fileName.indexOf(".") + 1) + _file_extension;

        const match = res.headers.get("Content-Range").match(contentRangeRegex);
        const startOffset = parseInt(match[1]);
        const endOffset = parseInt(match[2]);
        const totalSize = parseInt(match[3]);

        if (startOffset !== _next_offset) {
          throw new Error("Gap detected between responses.");
        }
        if (_total_size && totalSize !== _total_size) {
          throw new Error("Total size differs");
        }

        _next_offset = endOffset + 1;
        _total_size = totalSize;

        const progressPercent = ((_next_offset * 100) / _total_size).toFixed(0);
        logger.debug(`Progress: ${progressPercent}%`, fileName);
        updateProgress(videoId, fileName, progressPercent);

        const resBlob = await res.blob();
        if (_writable !== null) {
          await _writable.write(resBlob);
        } else {
          _blobs.push(resBlob);
        }

        if (!_total_size) throw new Error("_total_size is NULL");

        if (_next_offset < _total_size) {
          fetchNextPart(_writable);
        } else {
          if (_writable !== null) {
            await _writable.close();
            logger.info("Download finished", fileName);
          } else {
            save();
          }
          completeProgress(videoId);
        }
      } catch (reason) {
        logger.error(reason.message || reason, fileName);
        AbortProgress(videoId);
      }
    };

    const save = () => {
      logger.info("Concatenating blobs and downloading...", fileName);
      const blob = new Blob(_blobs, { type: "video/mp4" });
      const blobUrl = window.URL.createObjectURL(blob);
      logger.info("Final blob size: " + blob.size + " bytes", fileName);
      const a = document.createElement("a");
      document.body.appendChild(a);
      a.href = blobUrl;
      a.download = fileName;
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    };

    const supportsFileSystemAccess =
      "showSaveFilePicker" in unsafeWindow &&
      (() => {
        try { return unsafeWindow.self === unsafeWindow.top; }
        catch { return false; }
      })();

    if (supportsFileSystemAccess) {
      unsafeWindow
        .showSaveFilePicker({ suggestedName: fileName })
        .then((handle) => handle.createWritable())
        .then((writable) => {
          createProgressBar(videoId, fileName);
          fetchNextPart(writable);
        })
        .catch((err) => {
          if (err.name !== "AbortError") {
            console.error(err.name, err.message);
          }
        });
    } else {
      createProgressBar(videoId, fileName);
      fetchNextPart(null);
    }
  };

  // ==========================================================================
  // 오디오 다운로드 (원본 + 재시도 로직)
  // ==========================================================================
  const tel_download_audio = (url) => {
    let _blobs = [];
    let _next_offset = 0;
    let _total_size = null;
    const fileName = hashCode(url).toString(36) + ".ogg";

    const fetchNextPart = async (_writable) => {
      try {
        const res = await fetchChunkWithRetry(url, _next_offset, fileName);
        const mime = res.headers.get("Content-Type").split(";")[0];
        if (!mime.startsWith("audio/")) {
          throw new Error("Get non audio response with MIME type " + mime);
        }

        const match = res.headers.get("Content-Range").match(contentRangeRegex);
        const startOffset = parseInt(match[1]);
        const endOffset = parseInt(match[2]);
        const totalSize = parseInt(match[3]);

        if (startOffset !== _next_offset) throw new Error("Gap detected between responses.");
        if (_total_size && totalSize !== _total_size) throw new Error("Total size differs");

        _next_offset = endOffset + 1;
        _total_size = totalSize;

        const resBlob = await res.blob();
        if (_writable !== null) {
          await _writable.write(resBlob);
        } else {
          _blobs.push(resBlob);
        }

        if (_next_offset < _total_size) {
          fetchNextPart(_writable);
        } else {
          if (_writable !== null) {
            await _writable.close();
            logger.info("Download finished", fileName);
          } else {
            save();
          }
        }
      } catch (reason) {
        logger.error(reason.message || reason, fileName);
      }
    };

    const save = () => {
      let blob = new Blob(_blobs, { type: "audio/ogg" });
      const blobUrl = window.URL.createObjectURL(blob);
      blob = 0;
      const a = document.createElement("a");
      document.body.appendChild(a);
      a.href = blobUrl;
      a.download = fileName;
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
      logger.info("Download triggered", fileName);
    };

    const supportsFileSystemAccess =
      "showSaveFilePicker" in unsafeWindow &&
      (() => {
        try { return unsafeWindow.self === unsafeWindow.top; }
        catch { return false; }
      })();

    if (supportsFileSystemAccess) {
      unsafeWindow
        .showSaveFilePicker({ suggestedName: fileName })
        .then((handle) => handle.createWritable())
        .then((writable) => fetchNextPart(writable))
        .catch((err) => {
          if (err.name !== "AbortError") console.error(err.name, err.message);
        });
    } else {
      fetchNextPart(null);
    }
  };

  // ==========================================================================
  // 이미지 다운로드 (원본)
  // ==========================================================================
  const tel_download_image = (imageUrl) => {
    const fileName = (Math.random() + 1).toString(36).substring(2, 10) + ".jpeg";
    const a = document.createElement("a");
    document.body.appendChild(a);
    a.href = imageUrl;
    a.download = fileName;
    a.click();
    document.body.removeChild(a);
    logger.info("Download triggered", fileName);
  };

  // ==========================================================================
  // [개선 2] 선택 다운로드 모드 (원본 화질 자동 클릭 방식)
  // --------------------------------------------------------------------------
  // 동작 방식:
  // 1. 우상단 토글 버튼 클릭 → 선택 모드 ON
  // 2. 채팅의 미디어 메시지마다 좌상단에 체크박스 등장
  // 3. 원하는 것들 체크
  // 4. 우하단 "선택 항목 다운로드" 버튼 클릭
  // 5. 스크립트가 한 항목씩:
  //    - 메시지 미디어를 자동 클릭 → 미리보기 열림 → 원본 로드
  //    - 미리보기에서 원본 비디오/이미지 URL 캐치 → 다운로드 함수 호출
  //    - Esc로 미리보기 닫기
  //    - 2초 대기 → 다음 항목으로 이동
  //
  // ⚠️ 주의: 다운로드 진행 중에는 화면이 자동으로 깜빡거립니다.
  //          또한 Telegram 탭이 활성화 상태(앞에 보이는 상태)여야 합니다.
  // ==========================================================================
  const SelectMode = {
    enabled: false,
    selected: new Map(), // key: 메시지 ID, value: { bubble: HTMLElement, clickTarget: HTMLElement }
    isDownloading: false,

    toggle() {
      if (this.isDownloading) {
        alert("다운로드가 진행 중이에요. 끝날 때까지 기다려주세요.");
        return;
      }
      this.enabled = !this.enabled;
      const toggleBtn = document.getElementById("tel-download-mode-toggle");
      const downloadBtn = document.getElementById("tel-download-selected-btn");

      if (this.enabled) {
        toggleBtn.innerText = "✓ 선택 모드 ON";
        toggleBtn.style.backgroundColor = "#5288c1";
        toggleBtn.style.color = "white";
        downloadBtn.style.display = "block";
        this.startObserving();
      } else {
        toggleBtn.innerText = "선택 모드 OFF";
        toggleBtn.style.backgroundColor = "rgba(255,255,255,0.9)";
        toggleBtn.style.color = "black";
        downloadBtn.style.display = "none";
        this.clearAll();
        this.stopObserving();
      }
      this.updateBadge();
    },

    startObserving() {
      if (this._interval) return;
      // 채팅이 스크롤되거나 새 메시지가 추가되면 체크박스도 새로 붙여야 함
      this._interval = setInterval(() => this.attachCheckboxes(), 800);
      this.attachCheckboxes();
    },

    stopObserving() {
      if (this._interval) {
        clearInterval(this._interval);
        this._interval = null;
      }
    },

    // 메시지 버블에서 클릭 가능한 미디어 요소들을 모두 찾기
    // ⚠️ 앨범(여러 미디어가 묶인 메시지)의 경우 여러 개를 반환해야 함
    findClickTargets(bubble) {
      const isWebK = location.pathname.startsWith("/k/");
      const targets = [];

      if (isWebK) {
        // WebK 앨범: .bubble > .grouped-item (각 미디어가 하나의 grouped-item)
        // WebK 단일: .bubble > .attachment > .media-photo / .media-video
        const groupedItems = bubble.querySelectorAll(".grouped-item");
        if (groupedItems.length > 0) {
          // 앨범 케이스: 각 grouped-item이 클릭 대상
          groupedItems.forEach((item) => targets.push(item));
        } else {
          // 단일 미디어 케이스
          const single = bubble.querySelector(
            ".attachment .media-photo, .attachment .media-video, .attachment img, .attachment video, .media-photo, .media-video"
          );
          if (single) targets.push(single);
        }
      } else {
        // WebZ 앨범: .Message > .album-wrapper > .album-item-select-wrapper (각 항목)
        // WebZ 단일: .Message > .media-inner
        const albumItems = bubble.querySelectorAll(".album-item-select-wrapper, .album-item, .Album__item");
        if (albumItems.length > 0) {
          albumItems.forEach((item) => targets.push(item));
        } else {
          const single = bubble.querySelector(".media-inner img, .media-inner video, .media-inner");
          if (single) targets.push(single);
        }
      }

      // 아바타/프로필 사진 제외
      return targets.filter((t) => !t.closest(".avatar, .ProfilePhoto, .user-avatar, .peer-avatar"));
    },

    attachCheckboxes() {
      const isWebK = location.pathname.startsWith("/k/");
      const bubbles = document.querySelectorAll(isWebK ? ".bubble" : ".Message");

      bubbles.forEach((bubble) => {
        // 클릭 가능한 모든 미디어 요소 찾기 (앨범이면 여러 개)
        const clickTargets = this.findClickTargets(bubble);
        if (clickTargets.length === 0) return;

        const bubbleId = bubble.getAttribute("data-mid") ||
                         bubble.getAttribute("data-message-id") ||
                         bubble.id ||
                         "msg_" + Math.random().toString(36).substring(2, 10);

        clickTargets.forEach((clickTarget, index) => {
          // 이 미디어 요소에 이미 체크박스가 붙어있는지 확인
          if (clickTarget.querySelector(":scope > .tel-select-checkbox")) return;

          // 미디어별 고유 ID = 버블ID + 인덱스
          const mediaId = `${bubbleId}_${index}`;

          const checkbox = document.createElement("div");
          checkbox.className = "tel-select-checkbox";
          checkbox.style.cssText = `
            position: absolute;
            top: 8px;
            left: 8px;
            width: 28px;
            height: 28px;
            border: 2px solid white;
            border-radius: 50%;
            background-color: rgba(0,0,0,0.5);
            cursor: pointer;
            z-index: 100;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            color: white;
            font-weight: bold;
            box-shadow: 0 0 6px rgba(0,0,0,0.6);
            user-select: none;
          `;
          checkbox.dataset.mediaId = mediaId;

          checkbox.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            this.toggleSelection(mediaId, clickTarget, checkbox);
          };

          // clickTarget이 absolute 기준점이 되도록
          if (getComputedStyle(clickTarget).position === "static") {
            clickTarget.style.position = "relative";
          }
          clickTarget.appendChild(checkbox);
        });
      });
    },

    toggleSelection(mediaId, clickTarget, checkbox) {
      if (this.selected.has(mediaId)) {
        this.selected.delete(mediaId);
        checkbox.style.backgroundColor = "rgba(0,0,0,0.5)";
        checkbox.innerText = "";
      } else {
        this.selected.set(mediaId, { clickTarget });
        checkbox.style.backgroundColor = "#5288c1";
        checkbox.innerText = "✓";
      }
      this.updateBadge();
    },

    clearAll() {
      this.selected.clear();
      document.querySelectorAll(".tel-select-checkbox").forEach((cb) => cb.remove());
    },

    updateBadge() {
      const downloadBtn = document.getElementById("tel-download-selected-btn");
      if (downloadBtn) {
        const count = this.selected.size;
        downloadBtn.innerText = count > 0
          ? `📥 원본 화질로 다운로드 (${count})`
          : "📥 원본 화질로 다운로드";
        downloadBtn.disabled = count === 0;
        downloadBtn.style.opacity = count === 0 ? "0.5" : "1";
      }
    },

    // 미리보기가 열리고 원본 미디어 URL이 준비될 때까지 폴링
    waitForMediaViewer(timeoutMs) {
      const isWebK = location.pathname.startsWith("/k/");
      const startTime = Date.now();

      return new Promise((resolve, reject) => {
        const check = () => {
          let mediaUrl = null;
          let mediaType = null;

          if (isWebK) {
            const container = document.querySelector(SELECTORS.webk.mediaContainer);
            if (container) {
              const aspecter = container.querySelector(SELECTORS.webk.mediaAspecter);
              if (aspecter) {
                // 비디오 우선
                const video = aspecter.querySelector("video");
                if (video && video.src && !video.src.startsWith("blob:undefined")) {
                  mediaUrl = video.src;
                  mediaType = "video";
                } else {
                  const img = aspecter.querySelector("img.thumbnail");
                  if (img && img.src) {
                    // 썸네일이 아직 저화질일 수 있으므로, 좀 더 기다림
                    // img 가 thumbnail이 아니라 실제 원본인지 확인하기 위해 자연 사이즈 체크
                    if (img.naturalWidth > 100) {
                      mediaUrl = img.src;
                      mediaType = "image";
                    }
                  }
                }
              }
            }
          } else {
            // WebZ
            const container = document.querySelector(SELECTORS.webz.mediaContainer);
            if (container) {
              const videoPlayer = container.querySelector(SELECTORS.webz.videoPlayer);
              if (videoPlayer) {
                const video = videoPlayer.querySelector("video");
                if (video && video.currentSrc) {
                  mediaUrl = video.currentSrc;
                  mediaType = "video";
                }
              } else {
                const img = container.querySelector(SELECTORS.webz.imageInViewer);
                if (img && img.src && img.naturalWidth > 100) {
                  mediaUrl = img.src;
                  mediaType = "image";
                }
              }
            }
          }

          if (mediaUrl) {
            resolve({ url: mediaUrl, type: mediaType });
            return;
          }

          if (Date.now() - startTime > timeoutMs) {
            reject(new Error("미리보기 로드 타임아웃"));
            return;
          }

          setTimeout(check, 200);
        };
        check();
      });
    },

    // Esc 키 시뮬레이션으로 미리보기 닫기
    closeMediaViewer() {
      // 1차 시도: Esc 키 디스패치
      document.body.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        keyCode: 27,
        which: 27,
        bubbles: true,
        cancelable: true,
      }));

      // 2차 시도: 닫기 버튼 직접 클릭 (Esc가 안 먹을 경우 대비)
      setTimeout(() => {
        const isWebK = location.pathname.startsWith("/k/");
        if (isWebK) {
          const closeBtn = document.querySelector(".media-viewer-topbar .btn-icon.tgico-close");
          if (closeBtn) closeBtn.click();
        } else {
          const closeBtn = document.querySelector("#MediaViewer .MediaViewerActions .Button[title='Close']") ||
                           document.querySelector("#MediaViewer button[aria-label='Close']");
          if (closeBtn) closeBtn.click();
        }
      }, 100);
    },

    async downloadSelected() {
      if (this.selected.size === 0) {
        alert("선택된 항목이 없어요.");
        return;
      }
      if (this.isDownloading) return;

      const items = Array.from(this.selected.entries()); // [[id, {bubble, clickTarget}], ...]
      const total = items.length;
      const confirmMsg = `${total}개를 원본 화질로 다운로드합니다.\n` +
                        `약 ${Math.ceil(total * 2.5 / 60)}분 소요 예정.\n\n` +
                        `⚠️ 진행 중에는 화면이 자동으로 깜빡거립니다.\n` +
                        `⚠️ Telegram 탭을 활성 상태로 유지해주세요.\n\n` +
                        `시작할까요?`;
      if (!confirm(confirmMsg)) return;

      this.isDownloading = true;
      this.updateRunningStatus(0, total);

      let success = 0;
      let failed = 0;

      for (let i = 0; i < items.length; i++) {
        const [mediaId, info] = items[i];
        this.updateRunningStatus(i + 1, total);
        logger.info(`[${i + 1}/${total}] 다운로드 시도: ${mediaId}`);

        try {
          // 1) 미디어 클릭해서 미리보기 열기
          info.clickTarget.click();

          // 2) 원본 로드될 때까지 대기
          const media = await this.waitForMediaViewer(CONFIG.MEDIA_VIEWER_TIMEOUT);
          logger.info(`[${i + 1}/${total}] 원본 캐치: ${media.type} - ${media.url.substring(0, 80)}...`);

          // 3) 다운로드 함수 호출
          if (media.type === "video") {
            tel_download_video(media.url);
          } else {
            tel_download_image(media.url);
          }
          success++;

          // 4) 미리보기 닫기 (다운로드는 백그라운드에서 계속됨)
          await sleep(300);
          this.closeMediaViewer();
        } catch (err) {
          logger.error(`[${i + 1}/${total}] 실패: ${err.message}`);
          failed++;
          // 실패해도 미리보기는 닫고 다음으로
          this.closeMediaViewer();
        }

        // 5) 다음 항목 전 대기
        if (i < items.length - 1) {
          await sleep(CONFIG.SELECT_MODE_DELAY);
        }
      }

      this.isDownloading = false;
      this.updateRunningStatus(0, 0);
      this.clearAll();
      this.updateBadge();

      const msg = `완료!\n성공: ${success}개\n실패: ${failed}개\n\n` +
                  `다운로드는 우하단 진행률 바에서 확인하세요.\n` +
                  `(브라우저가 비디오를 받는 중일 수 있어요)`;
      alert(msg);
    },

    updateRunningStatus(current, total) {
      const downloadBtn = document.getElementById("tel-download-selected-btn");
      if (!downloadBtn) return;

      if (total === 0) {
        // 종료 상태 → 평소대로 돌아감
        downloadBtn.innerText = "📥 원본 화질로 다운로드";
        downloadBtn.style.backgroundColor = "#5288c1";
        return;
      }

      downloadBtn.innerText = `⏳ 처리 중... (${current}/${total})`;
      downloadBtn.style.backgroundColor = "#888";
      downloadBtn.disabled = true;
    },
  };

  // ==========================================================================
  // 토글 버튼 + 다운로드 버튼 UI 만들기
  // ==========================================================================
  const setupSelectModeUI = () => {
    // 1) 토글 버튼 (우상단)
    const toggleBtn = document.createElement("button");
    toggleBtn.id = "tel-download-mode-toggle";
    toggleBtn.innerText = "선택 모드 OFF";
    toggleBtn.style.cssText = `
      position: fixed;
      top: 12px;
      right: 12px;
      z-index: 9999;
      padding: 8px 14px;
      border: none;
      border-radius: 20px;
      background-color: rgba(255,255,255,0.9);
      color: black;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    `;
    toggleBtn.onclick = () => SelectMode.toggle();
    document.body.appendChild(toggleBtn);

    // 2) 다운로드 실행 버튼 (우하단, 진행률 바 위쪽)
    const downloadBtn = document.createElement("button");
    downloadBtn.id = "tel-download-selected-btn";
    downloadBtn.innerText = "📥 원본 화질로 다운로드";
    downloadBtn.style.cssText = `
      position: fixed;
      bottom: 80px;
      right: 12px;
      z-index: 9999;
      padding: 12px 18px;
      border: none;
      border-radius: 24px;
      background-color: #5288c1;
      color: white;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 2px 12px rgba(0,0,0,0.4);
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      display: none;
      opacity: 0.5;
    `;
    downloadBtn.onclick = () => SelectMode.downloadSelected();
    document.body.appendChild(downloadBtn);
  };

  // ==========================================================================
  // 진행률 바 컨테이너 셋업 (원본)
  // ==========================================================================
  const setupProgressBar = () => {
    const body = document.querySelector("body");
    const container = document.createElement("div");
    container.id = "tel-downloader-progress-bar-container";
    container.style.position = "fixed";
    container.style.bottom = 0;
    container.style.right = 0;
    container.style.zIndex = location.pathname.startsWith("/k/") ? 4 : 1600;
    body.appendChild(container);
  };

  // ==========================================================================
  // WebZ (/a/) 미디어 뷰어 감시 — 원본과 동일
  // ==========================================================================
  const setupWebzObserver = () => setInterval(() => {
    // Stories
    const storiesContainer = document.querySelector(SELECTORS.webz.storiesContainer);
    if (storiesContainer) {
      const createDownloadButton = () => {
        const downloadIcon = document.createElement("i");
        downloadIcon.className = "icon icon-download";
        const btn = document.createElement("button");
        btn.className = "Button TkphaPyQ tiny translucent-white round tel-download";
        btn.appendChild(downloadIcon);
        btn.setAttribute("type", "button");
        btn.setAttribute("title", "Download");
        btn.setAttribute("aria-label", "Download");
        btn.onclick = () => {
          const video = storiesContainer.querySelector("video");
          const videoSrc = video?.src || video?.currentSrc || video?.querySelector("source")?.src;
          if (videoSrc) {
            tel_download_video(videoSrc);
          } else {
            const images = storiesContainer.querySelectorAll(SELECTORS.webz.storyImageInViewer);
            const imageSrc = images[images.length - 1]?.src;
            if (imageSrc) tel_download_image(imageSrc);
          }
        };
        return btn;
      };

      const storyHeader =
        storiesContainer.querySelector(SELECTORS.webz.storyHeaderPrimary) ||
        storiesContainer.querySelector(SELECTORS.webz.storyHeaderFallback)?.parentNode;
      if (storyHeader && !storyHeader.querySelector(".tel-download")) {
        storyHeader.insertBefore(createDownloadButton(), storyHeader.querySelector("button"));
      }
    }

    const mediaContainer = document.querySelector(SELECTORS.webz.mediaContainer);
    const mediaViewerActions = document.querySelector(SELECTORS.webz.mediaViewerActions);
    if (!mediaContainer || !mediaViewerActions) return;

    const videoPlayer = mediaContainer.querySelector(SELECTORS.webz.videoPlayer);
    const img = mediaContainer.querySelector(SELECTORS.webz.imageInViewer);

    const downloadIcon = document.createElement("i");
    downloadIcon.className = "icon icon-download";
    const downloadButton = document.createElement("button");
    downloadButton.className = "Button smaller translucent-white round tel-download";
    downloadButton.setAttribute("type", "button");
    downloadButton.setAttribute("title", "Download");
    downloadButton.setAttribute("aria-label", "Download");

    if (videoPlayer) {
      const videoUrl = videoPlayer.querySelector("video").currentSrc;
      downloadButton.setAttribute("data-tel-download-url", videoUrl);
      downloadButton.appendChild(downloadIcon);
      downloadButton.onclick = () => tel_download_video(videoPlayer.querySelector("video").currentSrc);

      const controls = videoPlayer.querySelector(SELECTORS.webz.videoControls);
      if (controls) {
        const buttons = controls.querySelector(SELECTORS.webz.videoControlsButtons);
        if (buttons && !buttons.querySelector("button.tel-download")) {
          const spacer = buttons.querySelector(SELECTORS.webz.videoControlsSpacer);
          if (spacer) spacer.after(downloadButton);
        }
      }

      if (mediaViewerActions.querySelector("button.tel-download")) {
        const telDownloadButton = mediaViewerActions.querySelector("button.tel-download");
        if (mediaViewerActions.querySelectorAll('button[title="Download"]').length > 1) {
          mediaViewerActions.querySelector("button.tel-download").remove();
        } else if (telDownloadButton.getAttribute("data-tel-download-url") !== videoUrl) {
          telDownloadButton.onclick = () => tel_download_video(videoPlayer.querySelector("video").currentSrc);
          telDownloadButton.setAttribute("data-tel-download-url", videoUrl);
        }
      } else if (!mediaViewerActions.querySelector('button[title="Download"]')) {
        mediaViewerActions.prepend(downloadButton);
      }
    } else if (img && img.src) {
      downloadButton.setAttribute("data-tel-download-url", img.src);
      downloadButton.appendChild(downloadIcon);
      downloadButton.onclick = () => tel_download_image(img.src);

      if (mediaViewerActions.querySelector("button.tel-download")) {
        const telDownloadButton = mediaViewerActions.querySelector("button.tel-download");
        if (mediaViewerActions.querySelectorAll('button[title="Download"]').length > 1) {
          mediaViewerActions.querySelector("button.tel-download").remove();
        } else if (telDownloadButton.getAttribute("data-tel-download-url") !== img.src) {
          telDownloadButton.onclick = () => tel_download_image(img.src);
          telDownloadButton.setAttribute("data-tel-download-url", img.src);
        }
      } else if (!mediaViewerActions.querySelector('button[title="Download"]')) {
        mediaViewerActions.prepend(downloadButton);
      }
    }
  }, CONFIG.REFRESH_DELAY);

  // ==========================================================================
  // WebK (/k/) 미디어 뷰어 감시 — 원본과 동일
  // ==========================================================================
  const setupWebkObserver = () => setInterval(() => {
    // Voice Message or Circle Video
    const pinnedAudio = document.body.querySelector(SELECTORS.webk.pinnedAudio);
    let dataMid;
    let downloadButtonPinnedAudio =
      document.body.querySelector("._tel_download_button_pinned_container") ||
      document.createElement("button");
    if (pinnedAudio) {
      dataMid = pinnedAudio.getAttribute("data-mid");
      downloadButtonPinnedAudio.className =
        "btn-icon tgico-download _tel_download_button_pinned_container";
      downloadButtonPinnedAudio.innerHTML = `<span class="tgico button-icon">${DOWNLOAD_ICON}</span>`;
    }
    const audioElements = document.body.querySelectorAll(SELECTORS.webk.audioElement);
    audioElements.forEach((audioElement) => {
      const bubble = audioElement.closest(SELECTORS.webk.bubble);
      if (!bubble || bubble.querySelector("._tel_download_button_pinned_container")) return;
      if (
        dataMid &&
        downloadButtonPinnedAudio.getAttribute("data-mid") !== dataMid &&
        audioElement.getAttribute("data-mid") === dataMid
      ) {
        const link = audioElement.audio && audioElement.audio.getAttribute("src");
        const isAudio = audioElement.audio && audioElement.audio instanceof HTMLAudioElement;
        downloadButtonPinnedAudio.onclick = (e) => {
          e.stopPropagation();
          if (isAudio) tel_download_audio(link);
          else tel_download_video(link);
        };
        downloadButtonPinnedAudio.setAttribute("data-mid", dataMid);
        if (link) {
          pinnedAudio
            .querySelector(SELECTORS.webk.pinnedAudioUtils)
            .appendChild(downloadButtonPinnedAudio);
        }
      }
    });

    // Stories
    const storiesContainer = document.querySelector(SELECTORS.webk.storiesContainer);
    if (storiesContainer) {
      const createDownloadButton = () => {
        const btn = document.createElement("button");
        btn.className = "btn-icon rp tel-download";
        btn.innerHTML = `<span class="tgico">${DOWNLOAD_ICON}</span><div class="c-ripple"></div>`;
        btn.setAttribute("type", "button");
        btn.setAttribute("title", "Download");
        btn.setAttribute("aria-label", "Download");
        btn.onclick = () => {
          const video = storiesContainer.querySelector(SELECTORS.webk.storyVideo);
          const videoSrc = video?.src || video?.currentSrc || video?.querySelector("source")?.src;
          if (videoSrc) {
            tel_download_video(videoSrc);
          } else {
            const imageSrc = storiesContainer.querySelector(SELECTORS.webk.storyImage)?.src;
            if (imageSrc) tel_download_image(imageSrc);
          }
        };
        return btn;
      };

      const storyHeader = storiesContainer.querySelector(SELECTORS.webk.storyHeader);
      if (storyHeader && !storyHeader.querySelector(".tel-download")) {
        storyHeader.prepend(createDownloadButton());
      }
      const storyFooter = storiesContainer.querySelector(SELECTORS.webk.storyFooter);
      if (storyFooter && !storyFooter.querySelector(".tel-download")) {
        storyFooter.prepend(createDownloadButton());
      }
    }

    const mediaContainer = document.querySelector(SELECTORS.webk.mediaContainer);
    if (!mediaContainer) return;
    const mediaAspecter = mediaContainer.querySelector(SELECTORS.webk.mediaAspecter);
    const mediaButtons = mediaContainer.querySelector(SELECTORS.webk.mediaButtons);
    if (!mediaAspecter || !mediaButtons) return;

    const hiddenButtons = mediaButtons.querySelectorAll(SELECTORS.webk.hiddenButton);
    let onDownload = null;
    for (const btn of hiddenButtons) {
      btn.classList.remove("hide");
      if (btn.textContent === FORWARD_ICON) btn.classList.add("tgico-forward");
      if (btn.textContent === DOWNLOAD_ICON) {
        btn.classList.add("tgico-download");
        onDownload = () => btn.click();
      }
    }

    if (mediaAspecter.querySelector(SELECTORS.webk.videoPlayer)) {
      const controls = mediaAspecter.querySelector(SELECTORS.webk.videoControls);
      if (controls && !controls.querySelector(".tel-download")) {
        const brControls = controls.querySelector(SELECTORS.webk.videoRightControls);
        const downloadButton = document.createElement("button");
        downloadButton.className = "btn-icon default__button tgico-download tel-download";
        downloadButton.innerHTML = `<span class="tgico">${DOWNLOAD_ICON}</span>`;
        downloadButton.setAttribute("type", "button");
        downloadButton.setAttribute("title", "Download");
        downloadButton.setAttribute("aria-label", "Download");
        downloadButton.onclick = onDownload || (() => tel_download_video(mediaAspecter.querySelector("video").src));
        brControls.prepend(downloadButton);
      }
    } else if (
      mediaAspecter.querySelector("video") &&
      !mediaButtons.querySelector("button.btn-icon.tgico-download")
    ) {
      const downloadButton = document.createElement("button");
      downloadButton.className = "btn-icon tgico-download tel-download";
      downloadButton.innerHTML = `<span class="tgico button-icon">${DOWNLOAD_ICON}</span>`;
      downloadButton.setAttribute("type", "button");
      downloadButton.setAttribute("title", "Download");
      downloadButton.setAttribute("aria-label", "Download");
      downloadButton.onclick = onDownload || (() => tel_download_video(mediaAspecter.querySelector("video").src));
      mediaButtons.prepend(downloadButton);
    } else if (!mediaButtons.querySelector("button.btn-icon.tgico-download")) {
      const thumb = mediaAspecter.querySelector(SELECTORS.webk.thumbnailImage);
      if (!thumb || !thumb.src) return;
      const downloadButton = document.createElement("button");
      downloadButton.className = "btn-icon tgico-download tel-download";
      downloadButton.innerHTML = `<span class="tgico button-icon">${DOWNLOAD_ICON}</span>`;
      downloadButton.setAttribute("type", "button");
      downloadButton.setAttribute("title", "Download");
      downloadButton.setAttribute("aria-label", "Download");
      downloadButton.onclick = onDownload || (() => tel_download_image(thumb.src));
      mediaButtons.prepend(downloadButton);
    }
  }, CONFIG.REFRESH_DELAY);

  // ==========================================================================
  // 시작!
  // ==========================================================================
  logger.info("Initialized (custom version with select mode + retry)");
  setupProgressBar();
  setupSelectModeUI();
  setupWebzObserver();
  setupWebkObserver();
  logger.info("Completed script setup.");
})();
