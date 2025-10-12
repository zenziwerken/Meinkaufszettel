// ==========================================================
//  Hilfsfunktionen & Konstanten
// ==========================================================
const touchscreen = window.matchMedia("(pointer: coarse)").matches;

function showStatus(message, type) {
  const statusDiv = document.getElementById("status");
  if (!statusDiv) return;
  statusDiv.textContent = message;
  statusDiv.className = "status " + (type || "");
  setTimeout(() => {
    statusDiv.textContent = "";
    statusDiv.className = "status";
  }, 5000);
}

function replaceSpacesWithUnderscores(text) {
  return text.replace(/\s+/g, "_").replaceAll("/", "~");
}
function replaceUnderscoresWithSpaces(text) {
  return text.replace(/_/g, " ").replaceAll("~", "/");
}

function getFilenameFromUrl() {
  const search = window.location.search;
  if (!search || search === "?") return "";
  const searchStr = search.substring(1);
  try {
    return decodeURIComponent(searchStr);
  } catch {
    return searchStr;
  }
}

function setupEnterKeyListener(elementId, callback) {
  const element = document.getElementById(elementId);
  if (element) {
    element.addEventListener("keypress", function (e) {
      if (e.key === "Enter") callback();
    });
  } else {
    console.warn(`Element mit der ID "${elementId}" nicht gefunden.`);
  }
}

// ==========================================================
//  Server-Interaktionen (save/load/list)
 // ==========================================================
function saveListToServer(filename, activeItems, inactiveItems, onSuccess, onError) {
  fetch("bin/backend.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "save",
      filename,
      active: activeItems,
      inactive: inactiveItems,
    }),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.success) onSuccess?.(data);
      else onError?.(data.error || "Unbekannter Fehler");
    })
    .catch((error) => onError?.(error));
}

function fetchAllLists(onSuccess, onError) {
  fetch("bin/backend.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "list" }),
  })
    .then((response) => {
      if (!response.ok) throw new Error("Listen konnten nicht geladen werden");
      return response.json();
    })
    .then((data) => {
      if (Array.isArray(data)) onSuccess?.(data);
      else onError?.(data.error || "Antwortformat ungültig");
    })
    .catch((error) => onError?.(error.message || error));
}

function loadList() {
  let filename = document.getElementById("filename")?.value.trim() || getFilenameFromUrl() || "liste";

  fetch("bin/backend.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "load", id: filename }),
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Serverfehler (${response.status}) beim Laden der Liste.`);
      }
      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error("Ungültige Serverantwort – kein gültiges JSON erhalten.");
      }
      if (data.success === false) {
        throw new Error(data.error || "Unbekannter Backend-Fehler.");
      }

      const ulActive = document.getElementById("itemList");
      const ulInactive = document.getElementById("inactiveList");
      if (!ulActive || !ulInactive) return;

      ulActive.innerHTML = "";
      ulInactive.innerHTML = "";

      if (Array.isArray(data.active)) {
        data.active.forEach((item) => ulActive.appendChild(createActiveItem(item)));
      }
      if (Array.isArray(data.inactive)) {
        data.inactive.forEach((item) => ulInactive.appendChild(createInactiveItem(item)));
        sortInactiveList();
      }
    })
    .catch((error) => {
      showStatus("Fehler: " + error.message, "error");
      console.error("Fehler beim Laden der Liste:", error);
    });
}

// ==========================================================
//  Auth (register / login)
// ==========================================================
function register() {
  const passCode = document.getElementById("passCode")?.value.trim();
  if (!passCode) {
    showStatus("Bitte Passwort eingeben.", "error");
    return;
  }

  fetch("bin/backend.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "register", password: passCode }),
  })
    .then((response) =>
      response.json().then((data) => {
        if (!response.ok) throw { status: response.status, message: data.error || "Unbekannter Serverfehler" };
        return data;
      })
    )
    .then((data) => {
      if (data.success) location.reload();
      else showStatus(data.message || "Falsches Passwort.", "error");
    })
    .catch((error) => showStatus(error.message || "Fehler beim Login: " + error, "error"));
}

function login() {
  const passCode = document.getElementById("passCode")?.value.trim();
  if (!passCode) {
    showStatus("Bitte Passwort eingeben.", "error");
    return;
  }

  fetch("bin/backend.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", password: passCode }),
  })
    .then((response) =>
      response.json().then((data) => {
        if (!response.ok) throw { status: response.status, message: data.error || "Unbekannter Serverfehler" };
        return data;
      })
    )
    .then((data) => {
      if (data.success) {
        document.getElementById("login").style.display = "none";
        document.getElementById("listElements").style.display = "none";
        document.getElementById("listOverview").style.display = "";
        setTimeout(() => {
          fetchAllLists(showServerLists, (error) => showStatus("Fehler beim Laden der Listen: " + error, "error"));
        }, 100);
      } else {
        showStatus(data.message || "Falsches Passwort.", "error");
      }
    })
    .catch((error) => showStatus(error.message || "Fehler beim Login: " + error, "error"));
}

// ==========================================================
//  Element-Erzeugung (active / inactive)
// ==========================================================
function createActiveItem(text) {
  const li = document.createElement("li");
  li.innerHTML = `
    <span class="dragHandle" draggable="true" title="Verschieben"></span>
    <span class="itemText">${text}</span>
    <button class="editBtn" title="Umbenennen" onclick="editItem(this)"></button>
  `;

  function updateDraggableState() {
    const itemList = document.getElementById("itemList");
    const itemCount = itemList ? itemList.children.length : 0;
    const handle = li.querySelector(".dragHandle");
    if (itemCount > 1 && !touchscreen) {
      li.draggable = true;
      if (handle) handle.style.cursor = "grab";
    } else {
      li.draggable = false;
      if (handle) handle.style.cursor = "default";
    }
  }

  setTimeout(updateDraggableState, 0);

  const observerTarget = document.getElementById("itemList");
  if (observerTarget) {
    const observer = new MutationObserver(updateDraggableState);
    observer.observe(observerTarget, { childList: true });
    li._observer = observer;
  }

  li.addEventListener("click", function (e) {
    if (e.target.classList.contains("editBtn") || e.target.closest("button")) return;
    moveToInactive(li);
  });

  // optional: markiere speiseplan
  if (typeof speiseplanName !== "undefined" && getFilenameFromUrl() === speiseplanName) {
    li.classList.add("speiseplan");
  }

  return li;
}

function createInactiveItem(text) {
  const li = document.createElement("li");
  li.innerHTML = `
    <span class="itemText">${text}</span>
    <button class="deleteBtn" title="Löschen" onclick="deleteInactiveItem(this)"></button>
  `;
  li.addEventListener("click", function (e) {
    if (e.target.classList.contains("deleteBtn") || e.target.closest("button")) return;
    moveToActive(li);
  });
  return li;
}

// ==========================================================
//  Suche / Dropdown für neues Item (setupItemSearch)
// ==========================================================
function setupItemSearch() {
  const input = document.getElementById("newItem");
  if (!input) return;

  let dropdown = document.getElementById("itemSearchDropdown");
  if (!dropdown) {
    dropdown = document.createElement("div");
    dropdown.id = "itemSearchDropdown";
    dropdown.className = "search-dropdown";
    input.parentElement.appendChild(dropdown);
  }

  function positionDropdown() {
    dropdown.style.left = input.offsetLeft + "px";
    dropdown.style.top = input.offsetTop + input.offsetHeight + "px";
    dropdown.style.width = input.offsetWidth + "px";
  }

  input.addEventListener("input", function () {
    const searchText = input.value.trim().toLowerCase();
    positionDropdown();
    dropdown.innerHTML = "";

    if (searchText.length < 3) {
      dropdown.style.display = "none";
      return;
    }

    const activeLis = Array.from(document.querySelectorAll("#itemList li"));
    const inactiveLis = Array.from(document.querySelectorAll("#inactiveList li"));

    const activeItems = activeLis.map((li) => li.querySelector(".itemText").textContent.trim());
    const inactiveItems = inactiveLis.map((li) => li.querySelector(".itemText").textContent.trim());

    const allItems = [...new Set([...activeItems, ...inactiveItems])];
    const foundItems = allItems.filter((item) => item.toLowerCase().includes(searchText));

    if (foundItems.length === 0) {
      dropdown.style.display = "none";
      return;
    }

    // ✨ Aufleuchten für aktive Treffer
    activeLis.forEach((li) => {
      const text = li.querySelector(".itemText").textContent.trim().toLowerCase();
      if (foundItems.some((item) => item.toLowerCase() === text)) {
        li.classList.add("flash");
        li.addEventListener("animationend", () => li.classList.remove("flash"), { once: true });
      }
    });

    foundItems.forEach((item) => {
      const option = document.createElement("div");
      option.textContent = item;
      option.className = "dropdown-option";

      option.addEventListener("mousedown", function (e) {
        e.preventDefault();
        input.value = item;
        dropdown.style.display = "none";

        // Wenn inaktiv vorhanden → aktivieren
        if (inactiveItems.includes(item)) {
          const li = inactiveLis.find((li) => li.querySelector(".itemText").textContent.trim() === item);
          if (li) {
            moveToActive(li);
            input.value = "";
          }
        }
      });

      dropdown.appendChild(option);
    });

    dropdown.style.display = "block";
  });

  // optional: bei Resize/Scroll die Position anpassen
  window.addEventListener("resize", positionDropdown);
  window.addEventListener("scroll", positionDropdown);
}

// ==========================================================
//  Drag & Drop (Maus & Touch) + Hilfsfunktion getDragAfterElement
// ==========================================================
let draggedLi = null;

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll("li:not(.dragging)")];
  return draggableElements.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      } else {
        return closest;
      }
    },
    { offset: Number.NEGATIVE_INFINITY }
  ).element;
}

function setupDragAndDrop() {
  const itemList = document.getElementById("itemList");
  if (!itemList) return;

  if (!touchscreen) {
    // Mausbedienung
    itemList.addEventListener("dragstart", (e) => {
      const handle = e.target.closest(".dragHandle");
      const li = e.target.closest("li");
      if (handle && li && e.target.classList.contains("dragHandle")) {
        draggedLi = li;
        draggedLi.classList.add("dragging");
        // Drag preview
        try {
          e.dataTransfer.setDragImage(li, li.offsetWidth / 2, li.offsetHeight / 2);
        } catch (err) {
          // some browsers restrict setDragImage
        }
        setTimeout(() => (draggedLi.style.display = "none"), 0);
      } else {
        e.preventDefault();
      }
    });

    itemList.addEventListener("dragend", () => {
      if (draggedLi) {
        setTimeout(() => {
          draggedLi.style.display = "";
          draggedLi.classList.remove("dragging");
          draggedLi = null;
        }, 0);
        updateActiveOrder();
      }
    });

    itemList.addEventListener("dragover", (e) => {
      if (!draggedLi) return;
      e.preventDefault();
      Array.from(itemList.children).forEach((el) => el.classList.remove("drop-target"));
      const afterElement = getDragAfterElement(itemList, e.clientY);
      if (afterElement) afterElement.classList.add("drop-target");
    });

    itemList.addEventListener("drop", (e) => {
      if (!draggedLi) return;
      e.preventDefault();
      const afterElement = getDragAfterElement(itemList, e.clientY);
      Array.from(itemList.children).forEach((el) => el.classList.remove("drop-target"));
      if (afterElement == null) itemList.appendChild(draggedLi);
      else itemList.insertBefore(draggedLi, afterElement);
      setTimeout(() => {
        draggedLi.style.display = "";
        draggedLi.classList.remove("dragging");
        draggedLi = null;
      }, 0);
      updateActiveOrder();
    });
  } else {
    // Touch-Bedienung
    let touchStartY = 0;
    let isDragging = false;
    let dragStartTimeout = null;

    itemList.addEventListener(
      "touchstart",
      (e) => {
        const handle = e.target.closest(".dragHandle");
        const li = e.target.closest("li");
        if (li && handle) {
          e.preventDefault();
          draggedLi = li;
          touchStartY = e.touches[0].clientY;
          dragStartTimeout = setTimeout(() => {
            isDragging = true;
            if (draggedLi) draggedLi.classList.add("dragging");
          }, 100);
        }
      },
      { passive: false }
    );

    itemList.addEventListener(
      "touchmove",
      (e) => {
        if (!isDragging || !draggedLi) return;
        e.preventDefault();
        const touchY = e.touches[0].clientY;
        if (Math.abs(touchY - touchStartY) < 10) return;
        if (dragStartTimeout) {
          clearTimeout(dragStartTimeout);
          dragStartTimeout = null;
        }
        const afterElement = getDragAfterElement(itemList, touchY);
        if (afterElement == null) itemList.appendChild(draggedLi);
        else itemList.insertBefore(draggedLi, afterElement);
      },
      { passive: false }
    );

    itemList.addEventListener("touchend", (e) => {
      if (dragStartTimeout) {
        clearTimeout(dragStartTimeout);
        dragStartTimeout = null;
      }
      if (draggedLi && isDragging) {
        draggedLi.classList.remove("dragging");
        updateActiveOrder();
      }
      isDragging = false;
      draggedLi = null;
    });

    itemList.addEventListener("touchcancel", (e) => {
      if (dragStartTimeout) {
        clearTimeout(dragStartTimeout);
        dragStartTimeout = null;
      }
      if (draggedLi) draggedLi.classList.remove("dragging");
      isDragging = false;
      draggedLi = null;
    });
  }
}

// Speichert die neue Reihenfolge auf dem Server
function updateActiveOrder() {
  const filename = document.getElementById("filename")?.value.trim() || getFilenameFromUrl() || "liste";
  const activeItems = Array.from(document.querySelectorAll("#itemList li")).map((li) =>
    li.querySelector(".itemText").textContent.trim()
  );
  const inactiveItems = Array.from(document.querySelectorAll("#inactiveList li")).map((li) =>
    li.querySelector(".itemText").textContent.trim()
  );

  saveListToServer(
    filename,
    activeItems,
    inactiveItems,
    function () {
      // no-op on success
    },
    function (error) {
      showStatus("Fehler beim Speichern der Reihenfolge: " + error, "error");
    }
  );
}

// ==========================================================
//  Verschieben, löschen, sortieren (moveToInactive/Active, deleteInactiveItem, sortInactiveList)
// ==========================================================
function sortInactiveList() {
  const ul = document.getElementById("inactiveList");
  if (!ul) return;
  const items = Array.from(ul.children);
  items.sort((a, b) => {
    const ta = a.querySelector(".itemText").textContent.trim().toLowerCase();
    const tb = b.querySelector(".itemText").textContent.trim().toLowerCase();
    return ta.localeCompare(tb, "de");
  });
  items.forEach((li) => ul.appendChild(li));
}

function moveToInactive(li) {
  if (!li) return;
  const text = li.querySelector(".itemText").textContent.trim();
  const activeItems = Array.from(document.querySelectorAll("#itemList li")).map((l) =>
    l.querySelector(".itemText").textContent.trim()
  );
  const inactiveItems = Array.from(document.querySelectorAll("#inactiveList li")).map((l) =>
    l.querySelector(".itemText").textContent.trim()
  );
  const newActiveItems = activeItems.filter((item) => item !== text);
  const newInactiveItems = [...inactiveItems, text];

  let filename = document.getElementById("filename")?.value.trim();
  if (!filename) filename = getFilenameFromUrl() || "liste";

  saveListToServer(
    filename,
    newActiveItems,
    newInactiveItems,
    function () {
      const inactiveLi = createInactiveItem(text);
      document.getElementById("inactiveList")?.appendChild(inactiveLi);
      if (li.parentElement) li.parentElement.removeChild(li);
      sortInactiveList();
    },
    function (error) {
      showStatus(`Fehler: ${error}`, "error");
    }
  );
}

function moveToActive(li) {
  if (!li) return;
  const text = li.querySelector(".itemText").textContent.trim();
  const activeItems = Array.from(document.querySelectorAll("#itemList li")).map((l) =>
    l.querySelector(".itemText").textContent.trim()
  );
  const inactiveItems = Array.from(document.querySelectorAll("#inactiveList li")).map((l) =>
    l.querySelector(".itemText").textContent.trim()
  );
  const newInactiveItems = inactiveItems.filter((item) => item !== text);
  const newActiveItems = [...activeItems, text];

  let filename = document.getElementById("filename")?.value.trim();
  if (!filename) filename = getFilenameFromUrl() || "liste";

  saveListToServer(
    filename,
    newActiveItems,
    newInactiveItems,
    function () {
      const activeLi = createActiveItem(text);
      document.getElementById("itemList")?.appendChild(activeLi);
      if (li.parentElement) li.parentElement.removeChild(li);
      sortInactiveList();
    },
    function (error) {
      showStatus(`Fehler: ${error}`, "error");
    }
  );
}

function deleteInactiveItem(button) {
  const li = button?.parentElement;
  if (!li) return;
  const text = li.querySelector(".itemText").textContent.trim();

  let filename = document.getElementById("filename")?.value.trim();
  if (!filename) filename = getFilenameFromUrl() || "liste";

  const activeItems = Array.from(document.querySelectorAll("#itemList li")).map((l) =>
    l.querySelector(".itemText").textContent.trim()
  );
  const inactiveItems = Array.from(document.querySelectorAll("#inactiveList li")).map((l) =>
    l.querySelector(".itemText").textContent.trim()
  );
  const newInactiveItems = inactiveItems.filter((item) => item !== text);

  saveListToServer(
    filename,
    activeItems,
    newInactiveItems,
    function () {
      if (li.parentElement) li.parentElement.removeChild(li);
      sortInactiveList();
    },
    function (error) {
      showStatus(`Fehler: ${error}`, "error");
    }
  );
}

// ==========================================================
//  Item-Bearbeitung (editItem) für aktive Items
// ==========================================================
function editItem(button) {
  const li = button.parentElement;
  const span = li.querySelector(".itemText");
  const oldText = span.textContent;
  const input = document.createElement("input");
  input.type = "text";
  input.value = oldText;
  input.className = "editInput";
  input.style.flex = "1";

  button.disabled = true;
  li.insertBefore(input, span);
  span.style.display = "none";
  input.focus();

  // Originaler Move-Handler (falls vorhanden) temporär entfernen
  const originalMoveHandler = li._moveHandler;
  if (originalMoveHandler) li.removeEventListener("click", originalMoveHandler);

  const tempHandler = function (e) {
    if (input.contains(e.target)) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    if (e.target.classList.contains("editBtn") || e.target.closest("button")) return;
  };
  li.addEventListener("click", tempHandler, { capture: true });

  let blurTimer = null;

  function cleanup() {
    if (blurTimer) {
      clearTimeout(blurTimer);
      blurTimer = null;
    }
    span.style.display = "";
    if (li.contains(input)) li.removeChild(input);
    li.removeEventListener("click", tempHandler, { capture: true });
    if (originalMoveHandler) li.addEventListener("click", originalMoveHandler);
    button.disabled = false;
  }

  function saveInput(el) {
    if (!el || el._saving) return;
    el._saving = true;

    const newText = el.value.trim();
    if (!newText || newText === oldText) {
      delete el._saving;
      cleanup();
      return;
    }

    const activeItems = Array.from(document.querySelectorAll("#itemList li")).map((itemLi) =>
      itemLi === li ? newText : itemLi.querySelector(".itemText").textContent.trim()
    );
    const inactiveItems = Array.from(document.querySelectorAll("#inactiveList li")).map((l) =>
      l.querySelector(".itemText").textContent.trim()
    );

    let filename = document.getElementById("filename")?.value.trim();
    if (!filename) filename = getFilenameFromUrl() || "liste";

    saveListToServer(
      filename,
      activeItems,
      inactiveItems,
      function () {
        span.textContent = newText;
      },
      function (error) {
        showStatus(`Fehler: ${error}`, "error");
      }
    );

    setTimeout(() => {
      delete el._saving;
      cleanup();
    }, 0);
  }

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      saveInput(input);
    }
    if (e.key === "Escape") {
      cleanup();
    }
  });

  input.addEventListener("blur", function () {
    blurTimer = setTimeout(function () {
      saveInput(input);
    }, 150);
  });
}

// ==========================================================
//  List-Übersicht bearbeiten (rename/delete) - showServerLists & editListItem
// ==========================================================
function showServerLists(lists) {
  const ul = document.getElementById("serverLists");
  if (!ul) return;
  ul.innerHTML = "";
  if (!lists.length) {
    ul.innerHTML = "<li>Keine Listen gefunden.</li>";
    return;
  }

  lists.forEach((list) => {
    const li = document.createElement("li");
    let entryText = "";
    if (list.itemCount === 1) entryText = "1&nbsp;Eintrag";
    else if (list.itemCount > 1) entryText = list.itemCount + "&nbsp;Einträge";

    const entryFilename = replaceUnderscoresWithSpaces(list.filename.replace(".json", ""));
    li.innerHTML = `
      <span class="itemText">
        <strong class="listFileName">${entryFilename}</strong>
        <span class="modified">(${entryText ? entryText + ", " + list.lastModified : list.lastModified})</span>
      </span>
      <button class="editBtn" title="Umbenennen" onclick="editListItem(this)"></button>
      <button class="deleteBtn" title="Liste löschen"></button>
    `;

    // Klick auf Listennamen: Liste laden / wechseln
    li.querySelector(".itemText").addEventListener("click", function (e) {
      window.location.href = "?" + encodeURIComponent(list.filename.replace(".json", ""));
      e.stopPropagation();
    });

    // Löschen-Button
    li.querySelector(".deleteBtn").addEventListener("click", function (e) {
      e.stopPropagation();
      if (!confirm("Möchten Sie die Liste wirklich löschen?")) return;
      fetch("bin/backend.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", filename: list.filename.replace(".json", "") }),
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            li.parentElement?.removeChild(li);
            fetchAllLists(showServerLists, function (error) {
              showStatus("Fehler beim Laden der Listen: " + (error || data.error), "error");
            });
          } else {
            showStatus("Fehler beim Löschen: " + (data.error || "Unbekannter Fehler"), "error");
          }
        })
        .catch((error) => showStatus("Fehler: " + error, "error"));
    });

    if (typeof speiseplanName !== "undefined" && entryFilename == speiseplanName) {
      li.classList.add("speiseplan");
    }

    ul.appendChild(li);
  });
}

function editListItem(button) {
  const li = button.parentElement;
  const span = li.querySelector(".listFileName");
  const spanitemText = li.querySelector(".itemText");
  const oldText = span.textContent;

  li.dataset.editing = "true";

  const input = document.createElement("input");
  input.type = "text";
  input.value = oldText;
  input.className = "editInput";
  input.style.flex = "1";

  button.disabled = true;
  li.insertBefore(input, spanitemText);
  spanitemText.style.display = "none";
  input.focus();

  const tempHandler = function (e) {
    if (!li.dataset.editing) return;
    if (input.contains(e.target)) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    if (e.target.classList.contains("editBtn") || e.target.closest("button")) return;
  };

  li.addEventListener("click", tempHandler, { capture: true });

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") finishEdit();
    if (e.key === "Escape") cancelEdit();
  });

  input.addEventListener("blur", function () {
    setTimeout(() => {
      if (
        li.dataset.editing &&
        (!li.contains(document.activeElement) || document.activeElement.tagName === "BUTTON")
      ) {
        finishEdit();
      }
    }, 10);
  });

  function finishEdit() {
    if (!li.dataset.editing) return;
    const newText = input.value.trim();
    if (newText && newText !== oldText) {
      const newFilename = replaceSpacesWithUnderscores(newText);
      fetch("bin/backend.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rename",
          oldFilename: replaceSpacesWithUnderscores(oldText),
          newFilename: newFilename,
        }),
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            span.textContent = newText;
          } else {
            showStatus(`Fehler: ${data.error || "Unbekannter Fehler"}`, "error");
          }
          cleanup();
          fetchAllLists(showServerLists, function (error) {
            showStatus("Fehler beim Laden der Listen: " + error, "error");
          });
        })
        .catch((error) => {
          showStatus(`Fehler: ${error}`, "error");
          cleanup();
        });
    } else {
      cleanup();
    }
  }

  function cancelEdit() {
    if (!li.dataset.editing) return;
    cleanup();
  }

  function cleanup() {
    delete li.dataset.editing;
    li.removeEventListener("click", tempHandler, { capture: true });

    if (input.parentElement === li) li.removeChild(input);
    spanitemText.style.display = "";
    button.disabled = false;
  }
}

// ==========================================================
//  UI: Add Item / Add List Item
// ==========================================================
function addItem() {
  const input = document.getElementById("newItem");
  const text = input.value.trim();
  if (!text) return;

  let filename =
    document.getElementById("filename").value.trim() ||
    getFilenameFromUrl() ||
    "liste";

  const activeItems = Array.from(document.querySelectorAll("#itemList li")).map(
    (li) => li.querySelector(".itemText").textContent.trim()
  );
  const inactiveItems = Array.from(
    document.querySelectorAll("#inactiveList li")
  ).map((li) => li.querySelector(".itemText").textContent.trim());

  saveListToServer(
    filename,
    [...activeItems, text],
    inactiveItems,
    () => {
      input.value = "";
      loadList();
    },
    (error) => showStatus(`Fehler: ${error}`, "error")
  );
}



function addListItem() {
  const input = document.getElementById("newListItem");
  const text = replaceSpacesWithUnderscores(input?.value.trim() || "");
  if (!text) return;

  fetch("bin/backend.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "create", filename: text }),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        if (input) input.value = "";
        fetchAllLists(showServerLists, function (error) {
          showStatus("Fehler beim Laden der Listen: " + error, "error");
        });
      } else {
        showStatus("Fehler: " + (data.error || "Unbekannter Fehler"), "error");
      }
    })
    .catch((error) => {
      showStatus("Fehler beim Hinzufügen: " + error, "error");
    });
}

// ==========================================================
//  Initialisierung bei DOMContentLoaded
// ==========================================================
document.addEventListener("DOMContentLoaded", function () {
  const urlFilename = getFilenameFromUrl();
  const listElements = document.getElementById("listElements");
  const listOverview = document.getElementById("listOverview");
  const loginDiv = document.getElementById("login");

  function isAuthenticated() {
    return document.cookie.split(";").some((c) => c.trim().startsWith("auth="));
  }

  if (isAuthenticated()) {
    if (loginDiv) loginDiv.style.display = "none";

    if (urlFilename) {
      if (listElements) listElements.style.display = "";
      if (listOverview) listOverview.style.display = "none";
      loadList();
      if (urlFilename === (typeof speiseplanName !== "undefined" ? speiseplanName : undefined)) {
        const newItem = document.getElementById("newItem");
        if (newItem) newItem.placeholder = "Es gibt ...";
      }
    } else {
      if (listElements) listElements.style.display = "none";
      if (listOverview) listOverview.style.display = "";
      fetchAllLists(showServerLists, function (error) {
        showStatus("Fehler beim Laden der Listen: " + error, "error");
      });
    }
  } else {
    if (loginDiv) loginDiv.style.display = "";
    if (listElements) listElements.style.display = "none";
    if (listOverview) listOverview.style.display = "none";
  }

  // Buttons
  document.getElementById("registerBtn")?.addEventListener("click", register);
  document.getElementById("loginBtn")?.addEventListener("click", login);
  document.getElementById("addListItemBtn")?.addEventListener("click", addListItem);
  document.getElementById("addItemBtn")?.addEventListener("click", addItem);

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        await cookieStore.delete("auth");
      } catch (e) {
        console.warn("Fehler beim Löschen des Cookies:", e);
      }
      location.reload();
    });
  }

  document.getElementById("backBtn")?.addEventListener("click", () => {
    window.location.href = window.location.origin + window.location.pathname;
  });

  // Enter-Tasten
  [
    { id: "newListItem", handler: addListItem },
    { id: "newItem", handler: addItem },
    { id: "passCode", handler: login },
  ].forEach(({ id, handler }) => {
    const el = document.getElementById(id);
    if (!el) return;

    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault(); // verhindert doppelten Login
        handler();
      }
    });
  });
  // Setup Extras
  setupItemSearch();
  setupDragAndDrop();

  // Zusätzliche Enter-Listener (falls Funktion separat aufgerufen wird)
  setupEnterKeyListener("newItem", addItem);
  setupEnterKeyListener("newListItem", addListItem);
  setupEnterKeyListener("passCode", login);
});
