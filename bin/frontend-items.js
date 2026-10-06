// Last modified: 2026/10/06 09:51:05

// ==========================================================
//  Element-Erzeugung (active / inactive)
// ==========================================================

function _findActiveLiByText(text) {
  try {
    const needle = String(text ?? '').trim();
    if (!needle) return null;
    const ul = document.getElementById('itemList');
    if (!ul) return null;
    const match = Array.from(ul.querySelectorAll('li .itemText')).find((el) => (el.textContent || '').trim() === needle);
    return match ? match.closest('li') : null;
  } catch (e) {
    return null;
  }
}

function createActiveItem(text) {
  // Falls der Eintrag bereits aktiv existiert, kein Duplikat erzeugen.
  // (Beim Neu-Rendern via loadList() ist die Liste zuvor geleert, daher greift das nicht.)
  const existing = _findActiveLiByText(text);
  if (existing) return existing;

  const li = document.createElement("li");
  // Erzeuge Elemente sicher (vermeide innerHTML mit nicht vertrauenswürdigen Inhalten)
  const dragHandle = document.createElement('span');
  dragHandle.className = 'dragHandle';
  dragHandle.title = 'Verschieben';
  dragHandle.setAttribute('draggable', 'true');

  const spanText = document.createElement('span');
  spanText.className = 'itemText';
  spanText.textContent = String(text ?? '');

  const editBtn = document.createElement('button');
  editBtn.className = 'editBtn';
  editBtn.title = 'Umbenennen';
  editBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    // Ignoriere click, wenn pointerdown gerade gespeichert hat
    if (this._justSaved) return;
    try { editItem(this); } catch (err) { console.error(err); }
  });

  li.appendChild(dragHandle);
  li.appendChild(spanText);
  // Markiere Items, die mit '!' enden, weiterhin mit einer CSS-Klasse
  let trimmed = '';
  try {
    trimmed = String(text || '').trim();
    if (trimmed.endsWith('!')) li.classList.add('has-exclamation');
    if (trimmed.endsWith('?')) li.classList.add('has-question');
    if (trimmed.startsWith('https://')) li.classList.add('has-link');
  } catch (e) { /* ignorieren */ }

  // Füge Linksymbol hinzu, falls der Text mit https:// beginnt
  if (trimmed.startsWith('https://')) {
    const linkIcon = document.createElement('a');
    linkIcon.href = trimmed;
    linkIcon.target = '_blank';
    linkIcon.className = 'linkIcon';
    linkIcon.title = 'Link öffnen';
    linkIcon.addEventListener('click', (e) => e.stopPropagation());
    li.appendChild(linkIcon);
  }
  li.appendChild(editBtn);

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

  // Speichere den moveToInactive Handler, damit er später in editItem entfernt/hinzugefügt werden kann
  li._moveHandler = function (e) {
    if (e.target.classList.contains("editBtn") || e.target.closest("button")) return;
    moveToInactive(li);
  };

  li.addEventListener("click", li._moveHandler);

  // optional: markiere speiseplan
  if (typeof speiseplanName !== "undefined" && getFilenameFromUrl() === speiseplanName) {
    li.classList.add("speiseplan");
  }

  return li;
}

function createInactiveItem(text) {
  const li = document.createElement('li');

  const spanText = document.createElement('span');
  spanText.className = 'itemText';
  spanText.textContent = String(text ?? '');

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'deleteBtn';
  deleteBtn.title = 'Löschen';
  deleteBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    try { deleteInactiveItem(this); } catch (err) { console.error(err); }
  });

  li.appendChild(spanText);
  li.appendChild(deleteBtn);

  li.addEventListener('click', function (e) {
    if (e.target.classList.contains('deleteBtn') || e.target.closest('button')) return;
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

    if (searchText.length < 2) {
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
            moveToActive(li, { position: 'top', reconcileWithBackend: true });
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
let draggedListLi = null;

function setListNameDropHighlight(active) {
  const listNameTarget = document.getElementById("listName");
  if (!listNameTarget) return;
  listNameTarget.classList.toggle("relocate-drop-active", active);
  listNameTarget.setAttribute("aria-label", active ? "Element auf eine andere Liste verschieben" : listNameTarget.textContent.trim());
}

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

function ensureRelocateModal() {
  let modal = document.getElementById("relocateItemModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "relocateItemModal";
  modal.className = "modal";
  modal.setAttribute("aria-hidden", "true");
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.innerHTML = `
    <div class="modal-inner">
      <button type="button" class="modal-close" aria-label="Verschieben abbrechen">×</button>
      <h2 class="modal-title">Liste auswählen</h2>
      <div class="modal-body">
        <div id="relocateListOptions" style="display:flex; flex-direction:column; max-height:90%; overflow:auto;"></div>
        <div class="modal-actions">
          <button id="cancelRelocateItemBtn" type="button" class="btn btn-danger">Abbrechen</button>
        </div>
      </div>
    </div>
  `;

  const closeBtn = modal.querySelector(".modal-close");
  const cancelBtn = modal.querySelector("#cancelRelocateItemBtn");
  closeBtn?.addEventListener("click", closeRelocateModal);
  cancelBtn?.addEventListener("click", closeRelocateModal);

  document.body.appendChild(modal);
  return modal;
}

function closeRelocateModal() {
  const modal = document.getElementById("relocateItemModal");
  if (!modal) return;
  modal.setAttribute("aria-hidden", "true");
  modal.style.display = "none";
  const options = document.getElementById("relocateListOptions");
  if (options) options.innerHTML = "";
}

function openRelocateModal(itemText, sourceStatus) {
  const modal = ensureRelocateModal();
  const options = document.getElementById("relocateListOptions");
  if (!options) return;

  options.innerHTML = '<div class="note">Listen werden geladen …</div>';
  modal.setAttribute("aria-hidden", "false");
  modal.style.display = "flex";

  const currentList = document.getElementById("filename")?.value.trim() || getFilenameFromUrl() || "liste";

  fetchAllLists((lists) => {
    const unique = [];
    const seen = new Set();

    (Array.isArray(lists) ? lists : []).forEach((entry) => {
      const name = String(entry && entry.filename ? entry.filename : '').trim();
      if (!name || name === currentList || seen.has(name)) return;
      seen.add(name);
      unique.push(name);
    });

    options.innerHTML = "";

    if (!unique.length) {
      options.innerHTML = '<div class="note warning">Keine anderen Listen verfügbar.</div>';
      return;
    }

    unique.forEach((targetList) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn";
      button.textContent = replaceUnderscoresWithSpaces(targetList);
      button.addEventListener("click", async () => {
        const payload = {
          action: "relocate_item",
          sourceList: currentList,
          targetList,
          item: itemText,
          sourceStatus: sourceStatus || "active",
          targetStatus: "active"
        };

        closeRelocateModal();

        try {
          const response = await postToBackend(payload);
          let data = null;
          try { data = await response.json(); } catch (e) { data = null; }
          if (!response.ok) {
            const msg = data && (data.error || data.message) ? (data.error || data.message) : `Serverfehler: ${response.status}`;
            throw new Error(msg);
          }
          if (!data || data.success !== true) {
            throw new Error((data && (data.error || data.message)) || "Eintrag konnte nicht verschoben werden.");
          }
          showStatus("Eintrag verschoben.", "change");
          try { loadList(); } catch (e) {}
        } catch (error) {
          showStatus(error && error.message ? error.message : String(error), "error");
        }
      });
      options.appendChild(button);
    });
  }, (error) => {
    options.innerHTML = '<div class="note warning">Listen konnten nicht geladen werden.</div>';
    showStatus(error && error.message ? error.message : "Listen konnten nicht geladen werden.", "error");
  });
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
        // Drag-Vorschau
        try {
          e.dataTransfer.setDragImage(li, li.offsetWidth / 2, li.offsetHeight / 2);
        } catch (err) {
          // einige Browser schränken setDragImage ein
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

    const listNameTarget = document.getElementById("listName");
    if (listNameTarget) {
      listNameTarget.addEventListener("dragover", (e) => {
        if (!draggedLi) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setListNameDropHighlight(true);
      });

      listNameTarget.addEventListener("dragleave", () => {
        if (draggedLi) {
          setListNameDropHighlight(false);
        }
      });

      listNameTarget.addEventListener("drop", (e) => {
        if (!draggedLi) return;
        e.preventDefault();
        e.stopPropagation();

        const targetItem = draggedLi;
        const itemText = targetItem.querySelector(".itemText")?.textContent?.trim();
        const sourceStatus = targetItem.closest("#inactiveList") ? "inactive" : "active";

        if (!itemText) {
          setListNameDropHighlight(false);
          draggedLi = null;
          return;
        }

        setListNameDropHighlight(false);
        targetItem.classList.remove("dragging");
        targetItem.style.display = "";
        draggedLi = null;

        openRelocateModal(itemText, sourceStatus);
      });
    }
  } else {
    // Touch-Bedienung
    let isDragging = false;

    itemList.addEventListener(
      "touchstart",
      (e) => {
        const li = e.target.closest("li");
        const handle = e.target.closest(".dragHandle");

        if (!li || !handle) return;

        draggedLi = li;
        isDragging = true;
        setListNameDropHighlight(false);
        li.classList.add("dragging");
      },
      { passive: true }
    );

    itemList.addEventListener(
      "touchmove",
      (e) => {
        if (!draggedLi || !isDragging) return;

        e.preventDefault();

        const touch = e.touches && e.touches[0] ? e.touches[0] : null;
        if (touch) {
          const hit = document.elementFromPoint(touch.clientX, touch.clientY);
          const overListName = !!(hit && hit.closest && hit.closest("#listName"));
          setListNameDropHighlight(overListName);
        }

        const touchY = touch ? touch.clientY : 0;
        const afterElement = getDragAfterElement(itemList, touchY);

        // Nur verschieben wenn nötig → verhindert Flackern & Performance-Probleme
        if (afterElement !== draggedLi.nextSibling) {
          if (afterElement == null) {
            itemList.appendChild(draggedLi);
          } else {
            itemList.insertBefore(draggedLi, afterElement);
          }
        }
      },
      { passive: false }
    );

    itemList.addEventListener("touchend", (e) => {
      if (!draggedLi) {
        setListNameDropHighlight(false);
        return;
      }

      const touch = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0] : null;
      const hit = touch ? document.elementFromPoint(touch.clientX, touch.clientY) : null;
      const overListName = !!(hit && hit.closest && hit.closest("#listName"));
      const itemText = draggedLi.querySelector(".itemText")?.textContent?.trim();
      const sourceStatus = draggedLi.closest("#inactiveList") ? "inactive" : "active";

      setListNameDropHighlight(false);
      draggedLi.classList.remove("dragging");

      if (overListName && itemText) {
        draggedLi.style.display = "";
        draggedLi = null;
        isDragging = false;
        openRelocateModal(itemText, sourceStatus);
        return;
      }

      updateActiveOrder();
      draggedLi = null;
      isDragging = false;
    });

    itemList.addEventListener("touchcancel", () => {
      if (draggedLi) {
        draggedLi.classList.remove("dragging");
      }
      setListNameDropHighlight(false);
      draggedLi = null;
      isDragging = false;
    });
  }
}

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
      // keine Aktion bei Erfolg
    },
    function (error) {
      showStatus("Fehler beim Speichern der Reihenfolge: " + error, "error");
    }
  );
}

// Speichert die neue Listen-Reihenfolge
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
  // Verhindere Doppelaufrufe, wenn bereits ein Pending-Timer existiert
  if (li._undoTimer) return;

  const text = li.querySelector(".itemText").textContent.trim();
  // Entferne abschließendes '!' oder '?' wenn das Item inaktiv wird
  const stripped = String(text).replace(/([!?]+|\d+x)$/, '').trim();

  // UI: Zeige Rückgängig-Schaltfläche am aktiven Element und markiere als "pending"
  const undoBtn = document.createElement("button");
  undoBtn.className = "undoBtn";
  undoBtn.title = "Rückgängig";
  undoBtn.textContent = "Rückgängig";
  // Stoppe weitere Click-Propagation (verhindert erneutes Auslösen)
  undoBtn.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  li.appendChild(undoBtn);
  li.classList.add("pending-active");

  // Bereite die neuen Arrays für die spätere Speicherung vor (Item gilt als entfernt)
  const activeItems = Array.from(document.querySelectorAll("#itemList li")).map((l) =>
    l.querySelector(".itemText").textContent.trim()
  );
  const inactiveItems = Array.from(document.querySelectorAll("#inactiveList li")).map((l) =>
    l.querySelector(".itemText").textContent.trim()
  );

  const newActiveItems = activeItems.filter((item) => item !== text);
  // Stelle sicher, dass ein bereits inaktiv vorhandener Eintrag nicht dupliziert wird.
  // Dazu normalisieren wir alle Inaktiven mit der gleichen Strip-Logik.
  const normalizedInactiveItems = inactiveItems
    .map((item) => String(item || '').replace(/([!?]+|\d+x)$/, '').trim())
    .filter(Boolean);
  const newInactiveItems = [...new Set([...normalizedInactiveItems, stripped])];

  let filename = document.getElementById("filename")?.value.trim();
  if (!filename) filename = getFilenameFromUrl() || "liste";

  // Timer: nach 5 Sekunden tatsächlich auf dem Server speichern und Element verschieben
  li._undoTimer = setTimeout(() => {
    // Entferne visuelle Pending-Markierung bevor Save (UI-Feedback)
    li.classList.remove("pending-active");
    if (undoBtn.parentElement === li) li.removeChild(undoBtn);

    saveListToServer(
      filename,
      newActiveItems,
      newInactiveItems,
      function () {
        // Beim Erfolg: aktives li entfernen (falls noch vorhanden) und inaktives Element anfügen
        if (li.parentElement) li.parentElement.removeChild(li);
        // UI-seitig ebenfalls keine Duplikate erzeugen, falls das Item bereits inaktiv existiert
        const inactiveUl = document.getElementById("inactiveList");
        if (inactiveUl) {
          const alreadyInactive = Array.from(inactiveUl.querySelectorAll('li .itemText'))
            .some((el) => (el.textContent || '').trim() === stripped);
          if (!alreadyInactive) {
            const finalLi = createInactiveItem(stripped);
            inactiveUl.appendChild(finalLi);
          }
        }
        // Wenn keine aktiven Elemente mehr vorhanden sind, zeige das "Pyro"-Element
        try {
          const itemList = document.getElementById('itemList');
          const activeCount = itemList ? itemList.querySelectorAll('li').length : 0;
          if (activeCount === 0) {
            const pyro = document.getElementById('pyro');
            if (pyro) {
              pyro.classList.add('visible');
              void pyro.offsetWidth;
              setTimeout(() => { pyro.classList.remove('visible');}, 10000);
            }
          }
        } catch (e) {}

        sortInactiveList();
        updateActiveOrder();
      },
      function (error) {
        // Bei Fehler: Benutzer informieren und aktives Element wiederherstellen / belassen
        showStatus(`Fehler: ${error}`, "error");
        // Falls Element bereits entfernt wurde, füge ein neues Active-Element hinzu
        if (!document.querySelector(`#itemList li .itemText`) || !Array.from(document.querySelectorAll("#itemList li")).some(l => l.querySelector(".itemText").textContent.trim() === text)) {
          const restoredLi = createActiveItem(text);
          document.getElementById("itemList")?.prepend(restoredLi);
        } else {
          // Falls das ursprüngliche Element noch vorhanden ist: entferne pending-Markierung und die Schaltfläche
          if (li) {
            li.classList.remove("pending-active");
            if (undoBtn.parentElement === li) li.removeChild(undoBtn);
          }
        }
        sortInactiveList();
        updateActiveOrder();
      }
    );

    delete li._undoTimer;
  }, 5000);

  // Rückgängig-Handler: innerhalb der 5s Rückgängig machen (kein Server-Call)
  undoBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (li._undoTimer) {
      clearTimeout(li._undoTimer);
      delete li._undoTimer;
    }
    // Entferne UI-Pending-Markierung und die Rückgängig-Schaltfläche
    li.classList.remove("pending-active");
    if (undoBtn.parentElement === li) li.removeChild(undoBtn);
    // Keine Server-Änderung nötig — Reihenfolge ggf. neu speichern
    updateActiveOrder();
  });
}

function moveToActive(li, options) {
  if (!li) return;
  const text = li.querySelector(".itemText").textContent.trim();
  const opts = options && typeof options === 'object' ? options : {};
  const position = opts.position === 'top' ? 'top' : 'bottom';
  // Offline macht ein reconcile (loadList) keinen Sinn und kann die UI sogar wieder überschreiben.
  const reconcileWithBackend = (opts.reconcileWithBackend !== false) && !!navigator.onLine;
  const activeItems = Array.from(document.querySelectorAll("#itemList li")).map((l) =>
    l.querySelector(".itemText").textContent.trim()
  );
  const inactiveItems = Array.from(document.querySelectorAll("#inactiveList li")).map((l) =>
    l.querySelector(".itemText").textContent.trim()
  );
  const newInactiveItems = inactiveItems.filter((item) => item !== text);
  const alreadyActive = activeItems.includes(text);
  const baseActive = [...new Set(activeItems.filter(Boolean))];
  // Wenn bereits aktiv: nicht duplizieren. Bei "top" ggf. nach oben ziehen.
  const newActiveItems = alreadyActive
    ? (position === 'top' ? [text, ...baseActive.filter((i) => i !== text)] : baseActive)
    : (position === 'top' ? [text, ...baseActive] : [...baseActive, text]);

  let filename = document.getElementById("filename")?.value.trim();
  if (!filename) filename = getFilenameFromUrl() || "liste";

  // Optimistisches UI-Update: sofort sichtbar aktivieren (funktioniert auch offline)
  const ul = document.getElementById("itemList");
  const inactiveUl = document.getElementById("inactiveList");
  const prevNextSibling = li.nextSibling;
  const prevParent = li.parentElement;
  const activeLi = createActiveItem(text);
  let didInsertActive = false;
  try {
    if (ul && activeLi) {
      // Falls createActiveItem ein bereits existierendes Element zurückgibt, nur repositionieren
      if (position === 'top') ul.prepend(activeLi);
      else ul.appendChild(activeLi);
      didInsertActive = true;
    }
    if (li && li.parentElement) li.parentElement.removeChild(li);
    try { sortInactiveList(); } catch (e) {}
  } catch (e) {
    // Wenn UI-Optimismus schiefgeht, fahren wir trotzdem mit Save fort
  }

  saveListToServer(
    filename,
    newActiveItems,
    newInactiveItems,
    function (data) {
      // UI ist bereits optimistisch aktualisiert.
      // Optional: online Abgleich vom Backend (nur wenn wirklich online und kein Offline-Ack)
      const isOfflineAck = !!(data && data.offline);
      if (reconcileWithBackend && navigator.onLine && !isOfflineAck) {
        try { loadList(); } catch (e) {}
      }
    },
    function (error) {
      // Nicht-Netzwerkfehler: UI-Änderung revertieren
      try {
        if (didInsertActive && activeLi && activeLi.parentElement) {
          activeLi.parentElement.removeChild(activeLi);
        }
        if (prevParent && li) {
          if (prevNextSibling) prevParent.insertBefore(li, prevNextSibling);
          else prevParent.appendChild(li);
        } else if (inactiveUl && li) {
          inactiveUl.appendChild(li);
        }
        try { sortInactiveList(); } catch (e) {}
      } catch (e) {}
      showStatus(`Fehler: ${error}`, "error");
    }
  );
}


function deleteInactiveItem(button) {
  const li = button?.parentElement;
  if (!li) return;
  // Verhindere Doppelaufrufe, wenn bereits ein Pending-Timer existiert
  if (li._undoTimer) return;

  const text = li.querySelector(".itemText").textContent.trim();

  // UI: Zeige Rückgängig-Schaltfläche am inaktiven Element und markiere als "pending"
  const undoBtn = document.createElement("button");
  undoBtn.className = "undoBtn";
  undoBtn.title = "Rückgängig";
  undoBtn.textContent = "Rückgängig";
  // Stoppe weitere Click-Propagation
  undoBtn.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  li.appendChild(undoBtn);
  li.classList.add("pending-active");

  let filename = document.getElementById("filename")?.value.trim();
  if (!filename) filename = getFilenameFromUrl() || "liste";

  const activeItems = Array.from(document.querySelectorAll("#itemList li")).map((l) =>
    l.querySelector(".itemText").textContent.trim()
  );
  const inactiveItems = Array.from(document.querySelectorAll("#inactiveList li")).map((l) =>
    l.querySelector(".itemText").textContent.trim()
  );
  const newInactiveItems = inactiveItems.filter((item) => item !== text);

  // Timer: nach 5 Sekunden tatsächlich auf dem Server löschen
  li._undoTimer = setTimeout(() => {
    // Entferne visuelle Pending-Markierung bevor Save
    li.classList.remove("pending-active");
    if (undoBtn.parentElement === li) li.removeChild(undoBtn);

    saveListToServer(
      filename,
      activeItems,
      newInactiveItems,
      function () {
        // Erfolg: inaktives li entfernen
        if (li.parentElement) li.parentElement.removeChild(li);
        sortInactiveList();
        updateActiveOrder();
      },
      function (error) {
        // Fehler: Benutzer informieren und inaktives Element wiederherstellen / belassen
        showStatus(`Fehler: ${error}`, "error");
        // Falls Element nicht mehr vorhanden ist, füge ein neues hinzu
        if (
          !document.querySelector(`#inactiveList li .itemText`) ||
          !Array.from(document.querySelectorAll("#inactiveList li")).some(
            (l) => l.querySelector(".itemText").textContent.trim() === text
          )
        ) {
          const restoredLi = createInactiveItem(text);
          document.getElementById("inactiveList")?.appendChild(restoredLi);
        } else {
          if (li) {
            li.classList.remove("pending-active");
            if (undoBtn.parentElement === li) li.removeChild(undoBtn);
          }
        }
        sortInactiveList();
        updateActiveOrder();
      }
    );

    delete li._undoTimer;
  }, 5000);

  // Rückgängig-Handler: innerhalb der 5s Rückgängig machen (kein Server-Call)
  undoBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (li._undoTimer) {
      clearTimeout(li._undoTimer);
      delete li._undoTimer;
    }
    // Entferne UI-Pending-Markierung und die Rückgängig-Schaltfläche
    li.classList.remove("pending-active");
    if (undoBtn.parentElement === li) li.removeChild(undoBtn);
    // Keine Server-Änderung nötig
    sortInactiveList();
    updateActiveOrder();
  });
}

// ==========================================================
//  Item-Bearbeitung (editItem) für aktive Items
// ==========================================================
function editItem(button) {
  const li = button.parentElement;
  const span = li.querySelector(".itemText");
  const oldText = span.textContent;

  // Wenn bereits im Editing → als Save interpretieren
  if (button.classList.contains("editing")) {
    const existingInput = li.querySelector(".editInput");
    if (existingInput) saveInput(existingInput);
    return;
  }

  const input = document.createElement("input");
  input.type = "text";
  input.value = oldText;
  input.className = "editInput";
  input.style.flex = "1";

  // Mobile-Optimierungen
  input.style.fontSize = "16px"; // Verhindert iOS-Zoom
  input.setAttribute("enterkeyhint", "done");

  button.classList.add("editing");

  li.insertBefore(input, span);
  span.style.display = "none";

  // Fokus mit kurzer Verzögerung für mobile Geräte
  setTimeout(() => {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, 50);

  // Original-Handler temporär entfernen
  const originalMoveHandler = li._moveHandler;
  if (originalMoveHandler) {
    li.removeEventListener("click", originalMoveHandler);
  }

  let isCleaningUp = false;
  let isSaving = false;

  function cleanup() {
    if (isCleaningUp) return;
    isCleaningUp = true;

    // Blur-Listener ZUERST entfernen, bevor DOM-Änderungen blur auslösen
    input.removeEventListener("blur", blurHandler);

    span.style.display = "";
    if (li.contains(input)) li.removeChild(input);

    button.classList.remove("editing");

    if (originalMoveHandler) {
      li.addEventListener("click", originalMoveHandler);
    }

    document.removeEventListener("pointerdown", outsideHandler, true);

    // Button-Fokus entfernen
    if (button.blur) button.blur();
  }

  function saveInput(el) {
    if (!el || isSaving || isCleaningUp) return;
    isSaving = true;

    const newText = el.value.trim();

    // UI SOFORT zurücksetzen
    cleanup();

    // Keine Änderung → kein Server-Call nötig
    if (!newText || newText === oldText) {
      isSaving = false;
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
        // Success - UI updaten
        try {
          const nt = String(newText).trim();
          span.textContent = nt;

          li.classList.toggle("has-exclamation", nt.endsWith("!"));
          li.classList.toggle("has-question", nt.endsWith("?"));
          li.classList.toggle("has-link", nt.startsWith("https://"));

          const existingIcon = li.querySelector(".linkIcon");

          if (nt.startsWith("https://")) {
            if (!existingIcon) {
              const linkIcon = document.createElement("a");
              linkIcon.href = nt;
              linkIcon.target = "_blank";
              linkIcon.rel = "noopener noreferrer";
              linkIcon.className = "linkIcon";
              linkIcon.title = "Link öffnen";
              linkIcon.addEventListener("click", (e) => e.stopPropagation());
              linkIcon.addEventListener("touchend", (e) => {
                e.stopPropagation();
                window.open(nt, "_blank");
              });

              const editBtn = li.querySelector(".editBtn");
              if (editBtn) li.insertBefore(linkIcon, editBtn);
            } else {
              existingIcon.href = nt;
            }
          } else {
            if (existingIcon) existingIcon.remove();
          }

          showStatus("Gespeichert", "success");
        } catch (e) {
          console.error("UI-Update-Fehler:", e);
          span.textContent = newText; // Fallback
        }
      },
      function (error) {
        // Error - Text zurücksetzen
        console.error("Server-Fehler:", error);
        span.textContent = oldText;
        showStatus(`Fehler: ${error}`, "error");
      }
    );

    // isSaving zurücksetzen (async)
    setTimeout(() => {
      isSaving = false;
    }, 0);
  }

  function cancelEdit() {
    if (input.value !== oldText) {
      input.value = oldText;
    }
    cleanup();
  }

  // ENTER / ESC
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      saveInput(input);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  });

  // Blur als benannte Funktion – damit sie in cleanup() sauber entfernt werden kann
  function blurHandler() {
    if (input.value.trim() !== oldText) {
      // Änderung vorgenommen → saveInput aufrufen
      setTimeout(() => {
        if (!isCleaningUp && !isSaving) {
          saveInput(input);
        }
      }, 150);
    } else {
      // Keine Änderung → cleanup sofort aufrufen
      cleanup();
    }
  }

  input.addEventListener("blur", blurHandler);

  // Pointer außerhalb → speichern
  function outsideHandler(e) {
    if (!li.contains(e.target) && document.body.contains(e.target)) {
      if (!isCleaningUp && !isSaving) {
        saveInput(input);
      }
    }
  }

  document.addEventListener("pointerdown", outsideHandler, true);

  // Button im Editing-Zustand → Save
  button.addEventListener("pointerdown", function onPointerDown(e) {
    if (!button.classList.contains("editing")) return;

    e.preventDefault();
    e.stopPropagation();

    // Flag setzen, um nachfolgenden click zu ignorieren
    button._justSaved = true;
    setTimeout(() => delete button._justSaved, 0);

    saveInput(input);
  }, { once: true });
}

// ==========================================================
//  UI: Add Item / Add List Item
// ==========================================================
function addItem() {
  const input = document.getElementById("newItem");
  const text = input.value.trim();
  if (!text) return;
  const addBtn = document.getElementById("addItemBtn");
  
  const dropdown = document.getElementById("itemSearchDropdown");
  if (dropdown) dropdown.style.display = "none";

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

  // Verhindere doppelte aktive Einträge
  if (activeItems.includes(text)) {
    try {
      const existing = _findActiveLiByText(text);
      if (existing) {
        existing.classList.add('flash');
        existing.addEventListener('animationend', () => existing.classList.remove('flash'), { once: true });
      }
    } catch (e) {}
    input.value = "";
    return;
  }

  saveListToServer(
    filename,
    [text, ...activeItems],
    inactiveItems,
    () => {
      input.value = "";
      loadList();

      // Auf Touch-Geräten: Entferne möglichen Active/Hover-Zustand des Buttons.
      // Clone-Replace stellt sicher, dass mobile Browser keine aktive Darstellung behalten.
      try {
        if (touchscreen && addBtn && addBtn.parentElement) {
          const newBtn = addBtn.cloneNode(true);
          addBtn.parentElement.replaceChild(newBtn, addBtn);
          newBtn.addEventListener("click", addItem);
          newBtn.classList.remove("editing");
          newBtn.disabled = false;
          newBtn.blur && newBtn.blur();
          setTimeout(() => newBtn.blur && newBtn.blur(), 10);
        } else {
          addBtn && addBtn.blur && addBtn.blur();
        }
      } catch (e) {
        try { addBtn && addBtn.blur && addBtn.blur(); } catch (e) {}
      }
    },
    (error) => showStatus(`Fehler: ${error}`, "error")
  );
}



