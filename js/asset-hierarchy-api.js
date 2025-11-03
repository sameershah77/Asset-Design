// asset-hierarchy-api.js - Functions to interact with the Asset Hierarchy API

const API_BASE = 'https://localhost:7186/api';

/**
 * Fetches the asset hierarchy tree structure from the API
 * @returns {Promise<Object>} The asset hierarchy tree structure
 */
async function fetchAssetsByParentId(parentId = null) {
    try {
        const token = localStorage.getItem('accessToken');
        
        // Build URL: if parentId is null, don't append anything; otherwise append /parentId
        let url = `${API_BASE}/AssetHierarchy/GetByParentId`;
        if (parentId !== null && parentId !== undefined) {
            url += `/${parentId}`;
        }
        
        console.log('Fetching from URL:', url);
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token ? `Bearer ${token}` : ''
            },
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error(`API error: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log(`Assets retrieved for parent ID ${parentId}:`, data);
        return data;
    } catch (error) {
        console.error(`Error fetching assets for parent ID ${parentId}:`, error);
        throw error;
    }
}

/**
 * Initializes the tree with root node and sets up lazy loading of children
 */
async function initializeAssetHierarchy() {
    if ($('#assetTree').data('jstree')) {
        $('#assetTree').jstree('destroy');
    }
    
    try {
        // Show loading indicator
                // Initialize jsTree with robust lazy loading via core.data function
                $('#assetTree').jstree('destroy'); // ensure clean state before init
                $('#assetTree').jstree({
                    core: {
                        // Use a function so jsTree will call it for root and child loads
                        data: async function(obj, callback) {
                            try {
                                // Root call (obj.id === '#') -> fetch root assets
                                if (obj.id === '#') {
                                    const roots = await fetchAssetsByParentId();
                                    const nodes = (Array.isArray(roots) ? roots : []).map(a => ({
                                        id: `node_${a.id}`,
                                        text: a.name,
                                        children: true,
                                        data: { assetId: a.id }
                                    }));
                                    callback.call(this, nodes);
                                    return;
                                }

                                // For a non-root node, obj.id will be like 'node_6'
                                const match = String(obj.id).match(/node_(\d+)/);
                                const parentId = match ? Number(match[1]) : (obj.data?.assetId ?? null);
                                if (parentId === null || parentId === undefined) {
                                    callback.call(this, []);
                                    return;
                                }

                                const children = await fetchAssetsByParentId(parentId);
                                const nodes = (Array.isArray(children) ? children : []).map(c => ({
                                    id: `node_${c.id}`,
                                    text: c.name,
                                    children: true,
                                    data: { assetId: c.id }
                                }));
                                callback.call(this, nodes);
                            } catch (err) {
                                console.error('jsTree data loader error:', err);
                                callback.call(this, []);
                            }
                        },
                        themes: { responsive: true, variant: 'large', stripes: false },
                        check_callback: true
                    },
                    types: { default: { icon: 'jstree-icon jstree-file' } },
                plugins: ['state', 'wholerow', 'dnd', 'types', 'contextmenu'],
                contextmenu: {
                    items: function(node) {
                        const tree = $('#assetTree').jstree(true);
                        const isRoot = node.parent === '#';
                        const items = {
                            Create: {
                                label: 'Add Child',
                                action: function() {
                                    const newNodeId = tree.create_node(node, { text: 'New Asset' }, 'last');
                                    tree.edit(newNodeId, null, async function(updatedNode) {
                                        try {
                                            const parentBackendId = Number(node.data?.assetId ?? node.original?.data?.assetId ?? 0);
                                            await createAssetNode(parentBackendId, updatedNode.text);
                                            showNotification(`Created new asset "${updatedNode.text}"`, 'success');
                                            // Refresh the node so server-assigned ids show up next time
                                            try { tree.refresh_node(node); } catch(_) {}
                                        } catch (err) {
                                            showNotification('Failed to create node: ' + (err?.message || err), 'error');
                                            try { tree.delete_node(newNodeId); } catch (_) {}
                                        }
                                    });
                                }
                            },
                            Rename: {
                                label: 'Rename',
                                _disabled: isRoot,
                                action: function() {
                                    const oldName = node.text;
                                    const idNum = Number(node.data?.assetId ?? node.original?.data?.assetId ?? 0);
                                    tree.edit(node, null, async function(updatedNode) {
                                        try {
                                            const parentNode = tree.get_node(node.parent);
                                            const backendParentId = Number(node.parent === '#' ? 0 : (parentNode?.data?.assetId ?? parentNode?.original?.data?.assetId ?? 0));
                                            const updateDto = {
                                                Id: idNum,
                                                OldParentId: backendParentId,
                                                NewParentId: backendParentId,
                                                OldName: oldName,
                                                NewName: updatedNode.text
                                            };
                                            await updateAssetNode(updateDto);
                                            showNotification(`Updated asset name to "${updatedNode.text}"`, 'success');
                                        } catch (err) {
                                            showNotification('Failed to update node: ' + (err?.message || err), 'error');
                                            try { tree.rename_node(node, oldName); } catch (_) {}
                                        }
                                    });
                                }
                            },
                            Delete: {
                                label: 'Delete',
                                _disabled: isRoot,
                                action: function() {
                                    if (!confirm('Are you sure you want to delete this node?')) return;
                                    const backendId = Number(node.data?.assetId ?? node.original?.data?.assetId ?? 0);
                                    deleteAssetNode(backendId).then(() => {
                                        try { tree.delete_node(node); } catch (_) {}
                                        showNotification(`Asset "${node.text}" deleted successfully`, 'success');
                                    }).catch(err => {
                                        showNotification('Failed to delete node: ' + (err?.message || err), 'error');
                                    });
                                }
                            }
                        };
                        return items;
                    }
                }
                });

                // Notify when tree is ready
                $('#assetTree').on('ready.jstree', function() {
                    console.log('jsTree ready');
                    showNotification('Asset hierarchy loaded successfully', 'success');
                });

                // dblclick on node anchor -> open node (which triggers the core.data loader)
                $('#assetTree').off('dblclick.asset');
                $('#assetTree').on('dblclick.asset', 'li > a', function(e) {
                    const $li = $(this).closest('li');
                    if (!$li.length) return;
                    const id = $li.attr('id');
                    const tree = $('#assetTree').jstree(true);
                    if (!tree) return;
                    const node = tree.get_node(id);
                    if (!node) return;

                    if (!tree.is_open(node)) {
                        tree.open_node(node);
                    } else {
                        tree.refresh_node(node);
                    }
                });

                // Handle move (drag & drop)
                let isRevertingMove = false;
                $('#assetTree').off('move_node.jstree').on('move_node.jstree', async function(e, data) {
                    if (isRevertingMove) return;
                    const tree = $('#assetTree').jstree(true);
                    // Prevent moving root nodes
                    if (data && data.old_parent === '#') {
                        showNotification('Root node cannot be moved', 'warning');
                        isRevertingMove = true;
                        try { tree.move_node(data.node, data.old_parent); } catch (_) {}
                        isRevertingMove = false;
                        return;
                    }

                    try {
                        const movedNode = tree.get_node(data.node);
                        const idNum = Number(movedNode?.data?.assetId ?? movedNode?.original?.data?.assetId ?? 0);
                        const oldParentNode = data.old_parent === '#' ? null : tree.get_node(data.old_parent);
                        const newParentNode = data.parent === '#' ? null : tree.get_node(data.parent);
                        const oldParentId = Number(data.old_parent === '#' ? 0 : (oldParentNode?.data?.assetId ?? oldParentNode?.original?.data?.assetId ?? 0));
                        const newParentId = Number(data.parent === '#' ? 0 : (newParentNode?.data?.assetId ?? newParentNode?.original?.data?.assetId ?? 0));
                        const oldName = movedNode.original?.text || movedNode.text;
                        const newName = movedNode.text;

                        const moveDto = { Id: idNum, OldParentId: oldParentId, NewParentId: newParentId, OldName: oldName, NewName: newName };
                        await updateAssetNode(moveDto);
                        showNotification(`Moved asset "${movedNode.text}"`, 'success');
                    } catch (err) {
                        showNotification('Failed to move node: ' + (err?.message || err), 'error');
                        isRevertingMove = true;
                        try { $('#assetTree').jstree('move_node', data.node, data.old_parent); } catch (_) {}
                        isRevertingMove = false;
                    }
                });

        
        
    } catch (error) {
        console.error("Failed to initialize asset hierarchy:", error);
        $('#assetTree').html('<div class="error">Failed to load asset data: ' + error.message + '</div>');
        showNotification('Failed to load asset hierarchy: ' + error.message, 'error');
    }
}

/**
 * Creates a new asset node in the hierarchy
 * @param {number} parentId - The ID of the parent node
 * @param {string} name - The name of the new asset
 * @returns {Promise<Object>} The created asset node
 */
async function createAssetNode(parentId, name) {
    try {
        const token = localStorage.getItem('accessToken');
        const response = await fetch(`${API_BASE}/AssetHierarchy/InsertAsset`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token ? `Bearer ${token}` : ''
            },
            body: JSON.stringify({
                parentId: parentId,
                name: name
            }),
            credentials: 'include'
        });
        
        if (!response.ok) {
            // Try to surface server text for easier debugging
            const errText = await response.text().catch(() => '');
            const msg = errText ? `${response.status} ${response.statusText}: ${errText}` : `${response.status} ${response.statusText}`;
            throw new Error(`API error: ${msg}`);
        }

        // Some backends return plain text (e.g., "Asset Pushed") or empty body
        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('application/json')) {
            return await response.json();
        } else {
            const text = await response.text().catch(() => '');
            // Return a normalized object so callers can proceed without parsing errors
            return text ? { message: text } : {};
        }
    } catch (error) {
        console.error("Error creating asset node:", error);
        throw error;
    }
}

/**
 * Updates an asset node using a composite DTO (rename and/or move)
 * @param {{Id:number, OldParentId:number, NewParentId:number, OldName?:string, NewName?:string}} updateDto
 * @returns {Promise<Object>} API response (JSON or {message})
 */
async function updateAssetNode(updateDto) {
    try {
        const token = localStorage.getItem('accessToken');
        const response = await fetch(`${API_BASE}/AssetHierarchy/UpdateAsset`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token ? `Bearer ${token}` : ''
            },
            // Send DTO with PascalCase keys to match server DTO if required
            body: JSON.stringify(updateDto),
            credentials: 'include'
        });
        
        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            const msg = errText ? `${response.status} ${response.statusText}: ${errText}` : `${response.status} ${response.statusText}`;
            throw new Error(`API error: ${msg}`);
        }
        
        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('application/json')) {
            return await response.json();
        } else {
            const text = await response.text().catch(() => '');
            return text ? { message: text } : {};
        }
    } catch (error) {
        console.error("Error updating asset node:", error);
        throw error;
    }
}

/**
 * Deletes an asset node from the hierarchy
 * @param {number} id - The ID of the node to delete
 * @returns {Promise<boolean>} True if deletion was successful
 */
async function deleteAssetNode(id) {
    try {
        const token = localStorage.getItem('accessToken');
        const response = await fetch(`${API_BASE}/AssetHierarchy/DeleteAsset/${id}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token ? `Bearer ${token}` : ''
            },
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error(`API error: ${response.status} ${response.statusText}`);
        }
        
        return true;
    } catch (error) {
        console.error("Error deleting asset node:", error);
        throw error;
    }
}

/**
 * Moves an asset node to a new parent in the hierarchy
 * @param {number} id - The ID of the node to move
 * @param {number} newParentId - The ID of the new parent node
 * @returns {Promise<Object>} The moved asset node
 */
async function moveAssetNode(id, newParentId) {
    try {
        const token = localStorage.getItem('accessToken');
        const response = await fetch(`${API_BASE}/AssetHierarchy/MoveAsset`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token ? `Bearer ${token}` : ''
            },
            body: JSON.stringify({
                id: id,
                newParentId: newParentId
            }),
            credentials: 'include'
        });
        
        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            const msg = errText ? `${response.status} ${response.statusText}: ${errText}` : `${response.status} ${response.statusText}`;
            throw new Error(`API error: ${msg}`);
        }
        
        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('application/json')) {
            return await response.json();
        } else {
            const text = await response.text().catch(() => '');
            return text ? { message: text } : {};
        }
    } catch (error) {
        console.error("Error moving asset node:", error);
        throw error;
    }
}

/**
 * Fetches all deleted assets from the API
 * @returns {Promise<Object>} Object containing array of deleted assets
 */
async function fetchDeletedAssets() {
    try {
        const token = localStorage.getItem('accessToken');
        
        const response = await fetch(`${API_BASE}/AssetHierarchy/GetAllDeletedAssets`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token ? `Bearer ${token}` : ''
            },
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error(`API error: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log("Deleted assets data retrieved:", data);
        return data;
    } catch (error) {
        console.error("Error fetching deleted assets:", error);
        throw error;
    }
}

/**
 * Fetches all combinations count
 * GET /AssetHierarchy/GetAllCombinationsCountAsync
 * @returns {Promise<number>} Count of combinations
 */
async function getAllCombinationsCount() {
    try {
        const token = localStorage.getItem('accessToken');
        const resp = await fetch(`${API_BASE}/AssetHierarchy/GetAllCombinationsCount`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token ? `Bearer ${token}` : ''
            },
            credentials: 'include'
        });

        if (!resp.ok) {
            const errText = await resp.text().catch(() => '');
            const cleanMsg = (errText || `API error: ${resp.status} ${resp.statusText}`).replace(/^"|"$/g, '');
            throw new Error(cleanMsg);
        }

        const data = await resp.json();
        console.log("Combinations count retrieved:", data);
        
        // Backend returns { totalCombinations: number }
        if (data && typeof data.totalCombinations === 'number') {
            return data.totalCombinations;
        }
        // Fallback: if direct number
        return typeof data === 'number' ? data : 0;
    } catch (error) {
        console.error('Error fetching combinations count:', error);
        throw error;
    }
}

/**
 * Calculate average for a column
 * POST /AssetHierarchy/CalculateAverage with JSON string body
 * @param {string} columnName
 * @returns {Promise<Object>} Response object (e.g., { message: string })
 */
async function calculateAverage(columnName) {
    try {
        if (typeof columnName !== 'string' || !columnName.trim()) {
            throw new Error('Column name is required');
        }
        const token = localStorage.getItem('accessToken');
        const resp = await fetch(`${API_BASE}/AssetHierarchy/CalculateAverage`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token ? `Bearer ${token}` : ''
            },
            body: JSON.stringify(columnName.trim()), // server expects a raw string body
            credentials: 'include'
        });

        const contentType = (resp.headers.get('content-type') || '').toLowerCase();

        if (!resp.ok) {
            const errText = contentType.includes('application/json')
                ? JSON.stringify(await resp.json()).slice(0, 300)
                : (await resp.text().catch(() => ''));
            const cleanMsg = (errText || `API error: ${resp.status} ${resp.statusText}`).replace(/^"|"$/g, '');
            throw new Error(cleanMsg);
        }

        if (contentType.includes('application/json')) {
            return await resp.json();
        }
        const text = await resp.text().catch(() => '');
        return text ? { message: text } : {};
    } catch (error) {
        console.error('Error calculating average:', error);
        throw error;
    }
}

/**
 * Recursively converts an asset and its children to jsTree nodes
 * @param {Asset|DeletionAsset} asset - The asset to convert
 * @param {string} parentId - The ID of the parent node
 * @returns {Object[]} Array of jsTree nodes
 */
function assetToNodes(asset, parentId = '#') {
    const nodes = [];
    
    // Helper: compute total number of descendant nodes (all levels) for display
    function getDescendantCount(a) {
        const children = Array.isArray(a.Childrens) ? a.Childrens : (Array.isArray(a.childrens) ? a.childrens : []);
        let cnt = children.length;
        for (const c of children) cnt += getDescendantCount(c);
        return cnt;
    }

    // Handle both DeletionAsset and Asset types
    const nodeId = `d${asset.AssetId || asset.Id}`;
    const nodeName = asset.Name || asset.name;
    
    // Create node and append total descendant indicator (if any).
    // Note: we keep empty parentheses where children exist but remove the numeric count.
    const descCount = getDescendantCount(asset);
    const idPart = asset.AssetId || asset.Id;
    // Keep parentheses for nodes that have children, but remove the numeric count inside
    const displayText = parentId === '#' 
        ? `${nodeName}${descCount > 0 ? ' ()' : ''} (ID: ${idPart})` 
        : `${nodeName}${descCount > 0 ? ' ()' : ''}`;

    nodes.push({
        id: nodeId,
        parent: parentId,
        text: displayText,
        a_attr: {
            class: parentId === '#' ? 'deleted-asset-root' : 'deleted-asset-child',
            title: asset.ParentIds ? `Parent IDs: ${asset.ParentIds.join(', ')}` : undefined
        },
        type: 'deleted'
    });
    
    // Process children recursively
    const children = asset.Childrens || [];
    children.forEach(child => {
        nodes.push(...assetToNodes(child, nodeId));
    });
    
    return nodes;
}

/**
 * Converts deleted assets data to jsTree format
 * @param {DeletionAsset[]} deletedAssets - Array of deleted assets
 * @returns {Object[]} Array of jsTree nodes
 */
function convertDeletedToJsTree(deletedAssets) {
    let nodes = [];
    deletedAssets.forEach(asset => {
        nodes.push(...assetToNodes(asset));
    });
    return nodes;
}

/**
 * Initializes the deleted assets tree view
 * @returns {Promise<void>}
 */
async function initializeDeletedTree() {
    if ($('#deletedAssetsTree').data('jstree')) {
        $('#deletedAssetsTree').jstree('destroy');
    }
    
    try {
        // Show loading indicator
        $('#deletedAssetsTree').html('<div class="loading">Loading deleted assets...</div>');
        
        // Fetch and validate data
        const response = await fetchDeletedAssets();
        if (!response.DeletedAssets) {
            throw new Error('Invalid response format: DeletedAssets not found');
        }
        
        // Convert to tree format
        const treeData = convertDeletedToJsTree(response.DeletedAssets);
        
        // Initialize jsTree
        $('#deletedAssetsTree').jstree({
            'core': {
                'data': treeData,
                'themes': {
                    'responsive': true,
                    'variant': 'large',
                    'stripes': false
                },
                'check_callback': true
            },
            'types': {
                'deleted': {
                    'icon': 'jstree-icon jstree-file'
                }
            },
            'plugins': ['wholerow', 'types'],
        });
        
        // Open all nodes by default
        $('#deletedAssetsTree').on('ready.jstree', function() {
            $(this).jstree('open_all');
        });
        
        showNotification('Deleted assets loaded successfully', 'success');
        
    } catch (error) {
        console.error("Failed to initialize deleted tree view:", error);
        $('#deletedAssetsTree').html('<div class="error">Failed to load deleted assets. Please try refreshing.</div>');
        showNotification('Failed to load deleted assets', 'error');
    }
}

/**
 * Builds Deleted Assets as responsive cards with a compact, read-only tree for Childrens
 */
async function initializeDeletedCards() {
    try {
        const container = document.getElementById('deletedCards');
        if (!container) return;

        container.innerHTML = '<div class="loading">Loading deleted assets...</div>';

        const response = await fetchDeletedAssets();
        // Accept both PascalCase and camelCase from API
        const deletedAssets = Array.isArray(response?.DeletedAssets)
            ? response.DeletedAssets
            : (Array.isArray(response?.deletedAssets) ? response.deletedAssets : []);

        if (!deletedAssets.length) {
            container.innerHTML = '<div class="empty-info">No assets to retrieve.</div>';
            return;
        }

        // Helper to convert Asset model (Id, Name, Childrens) to jsTree flat nodes
        function toJsTreeFromAsset(asset, parentId = '#') {
            const nodes = [];
            const id = String(
                asset.Id ?? asset.AssetId ?? asset.id ?? asset.assetId ?? Math.random()
            );
            const name = asset.Name ?? asset.name ?? 'Unnamed';
            const childrenArr = Array.isArray(asset.Childrens) ? asset.Childrens : (Array.isArray(asset.childrens) ? asset.childrens : []);

            // compute total descendant count (all levels)
            function getDescCount(a) {
                const ch = Array.isArray(a.Childrens) ? a.Childrens : (Array.isArray(a.childrens) ? a.childrens : []);
                let c = ch.length;
                for (const cc of ch) c += getDescCount(cc);
                return c;
            }
            const totalDesc = getDescCount(asset);
            // Show empty parentheses when descendants exist, but omit numeric counts
            const display = totalDesc > 0 ? `${name} ()` : name;

            nodes.push({ id, parent: parentId, text: display, a_attr: { title: name } });

            childrenArr.forEach(child => {
                nodes.push(...toJsTreeFromAsset(child, id));
            });

            return nodes;
        }

        // Build cards markup
        const frag = document.createDocumentFragment();
        deletedAssets.forEach((da, idx) => {
            const card = document.createElement('div');
            card.className = 'deleted-card';

            const header = document.createElement('div');
            header.className = 'deleted-card-header';
                        const daId = (da.AssetId ?? da.assetId);
                        header.innerHTML = `
                                <div class="deleted-title-wrap">
                                    <h4 class="deleted-title">${da.Name || da.name || 'Deleted Asset'}</h4>
                                </div>
                                <div class="deleted-actions">
                                    <span class="deleted-meta">Asset ID: ${daId}</span>
                                    <button type="button" class="btn btn-sm btn-retrieve" data-id="${daId}">Retrieve</button>
                                </div>
                        `;

            const parentsRow = document.createElement('div');
            parentsRow.className = 'deleted-parents';
            const parentIds = Array.isArray(da.ParentIds) ? da.ParentIds : (Array.isArray(da.parentIds) ? da.parentIds : []);
            parentsRow.innerHTML = parentIds.length
                ? parentIds.map(p => `<span class="parent-chip">Parent ${p}</span>`).join('')
                : '<span class="deleted-meta">No parents</span>';

            const treeWrap = document.createElement('div');
            treeWrap.className = 'deleted-tree';

            // Create unique container for jsTree
            const treeEl = document.createElement('div');
            const treeId = `deletedTree_${da.AssetId}_${idx}`;
            treeEl.id = treeId;
            treeWrap.appendChild(treeEl);

            card.appendChild(header);
            card.appendChild(parentsRow);
            card.appendChild(treeWrap);
            frag.appendChild(card);

            // Prepare tree data from Childrens (Asset[])
            const children = Array.isArray(da.Childrens) ? da.Childrens : (Array.isArray(da.childrens) ? da.childrens : []);
            const treeData = children.length
                ? children.flatMap(child => toJsTreeFromAsset(child))
                : [];

            if (treeData.length === 0) {
                // Show an empty state instead of an empty tree
                const emptyEl = document.createElement('div');
                emptyEl.className = 'deleted-meta';
                emptyEl.textContent = 'No children';
                treeWrap.appendChild(emptyEl);
            } else {
                // Initialize a compact, read-only jsTree for this card
                setTimeout(() => {
                    const $el = $(`#${treeId}`);
                    if (!$el.length) return;
                    $el.jstree('destroy');
                    $el.jstree({
                        core: {
                            data: treeData,
                            check_callback: false,
                            themes: { responsive: true, variant: 'large', stripes: false }
                        },
                        plugins: ['wholerow']
                    }).on('ready.jstree', function() {
                        $(this).jstree('open_all');
                    });
                }, 0);
            }
        });

        container.innerHTML = '';
        container.appendChild(frag);
        // Bind retrieve handlers
        container.querySelectorAll('.btn-retrieve').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = Number(e.currentTarget.getAttribute('data-id'));
                const el = e.currentTarget;
                const prevText = el.textContent;
                // Lock button width to prevent layout shift when text changes
                const prevWidth = el.offsetWidth;
                el.style.width = prevWidth + 'px';
                el.disabled = true;
                el.textContent = 'Retrieving...';
                try {
                    const result = await retrieveDeletedAssetById(id);
                    // Explicitly handle server 204 No Content sentinel
                    if (result && result.__noContent) {
                        showNotification('No content returned from server (204) — the asset may have already been retrieved or there is no additional data.', 'info');
                    }
                    // If backend returns informational message about parents
                    else if (result && (result.Message || result.message)) {
                        const msg = result.Message || result.message;
                        const parents = result.ParentIds || result.parentIds;
                        const note = result.Note || result.note;
                        let mainMsg = msg;
                        if (Array.isArray(parents) && parents.length) mainMsg += ` (Parents: ${parents.join(', ')})`;
                        showNotification(mainMsg, 'warning');
                        if (note) showNotification(note, 'info');
                    } else {
                        const assetName = result?.Name || result?.name || 'Asset';
                        const assetId = result?.AssetId ?? result?.assetId ?? id;
                        showNotification(`Retrieved ${assetName} (ID: ${assetId})`, 'success');
                    }
                    // Refresh cards
                    await initializeDeletedCards();
                } catch (err) {
                    const raw = (err && err.message) ? err.message : 'Failed to retrieve asset';
                    // Remove surrounding quotes if error is a JSON-stringified plain string
                    const clean = raw.replace(/^\"|\"$/g, '').replace(/^"|"$/g, '');
                    showNotification(clean, 'error');
                } finally {
                    // If the DOM hasn't been rebuilt yet, restore button state
                    if (document.body.contains(el)) {
                        el.disabled = false;
                        el.textContent = prevText;
                        el.style.width = '';
                    }
                }
            });
        });
        showNotification('Deleted assets loaded', 'success');
    } catch (error) {
        console.error('Error building deleted asset cards:', error);
        const container = document.getElementById('deletedCards');
        if (container) {
            container.innerHTML = '<div class="error">Failed to load deleted assets.</div>';
        }
        showNotification('Failed to load deleted assets', 'error');
    }
}

/**
 * Calls backend to retrieve a deleted asset by ID (moves it back to main tree on server)
 * Returns parsed JSON (could be DeletionAsset or an info object with Message/ParentIds)
 */
async function retrieveDeletedAssetById(id) {
    try {
        const token = localStorage.getItem('accessToken');      
        const url = `${API_BASE}/AssetHierarchy/RetrieveDeletedAsset/${id}`;
        const resp = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token ? `Bearer ${token}` : ''
            },
            credentials: 'include'
        });
        // Quick toast for immediate visibility
        showToast(`RetrieveDeletedAsset response for ID ${id}: ${resp.status} ${resp.statusText}`);
        // Log full response and headers for debugging (helps determine if server sent no content)
        console.log(`RetrieveDeletedAsset response for ID ${id}:`, resp);
        try {
            for (const pair of resp.headers.entries()) {
                console.log(`RetrieveDeletedAsset header: ${pair[0]}: ${pair[1]}`);
            }
        } catch (hdrErr) {
            console.warn('Could not enumerate response headers', hdrErr);
        }

        const contentType = (resp.headers.get('content-type') || '').toLowerCase();

        // Handle explicit 204 No Content early: there is no body to parse.
        if (resp.status === 204) {
            console.info(`RetrieveDeletedAsset for ID ${id} returned 204 No Content`);
            // Return an explicit shape so callers know this was a no-content success
            return { __noContent: true };
        }
        if (!resp.ok) {
            const errText = contentType.includes('application/json')
                ? JSON.stringify(await resp.json()).slice(0, 300)
                : (await resp.text().catch(() => ''));
            const cleanMsg = (errText || `API error: ${resp.status} ${resp.statusText}`).replace(/^"|"$/g, '');
            console.error(`RetrieveDeletedAsset error for ID ${id}:`, errText);
            // Show the server-provided error to the user
            try { showToast(cleanMsg); } catch (_) {}
            throw new Error(cleanMsg);
        }
        if (contentType.includes('application/json')) {
            const body = await resp.json();
            console.log(`RetrieveDeletedAsset body for ID ${id}:`, body);
            return body;
        }
        // non-JSON
        const text = await resp.text().catch(() => '');
        console.log(`RetrieveDeletedAsset text for ID ${id}:`, text);
        return text ? { message: text } : {};
    } catch (error) {
        console.error(`RetrieveDeletedAsset exception for ID ${id}:`, error);
        throw error;
    }
}


  function showToast(msg){
    let t = document.querySelector('.toast');
    if(!t){
      t = document.createElement('div');
      t.className = 'toast';
      Object.assign(t.style,{position:'fixed',right:'20px',top:'20px',padding:'10px 14px',background:'#111827',color:'#fff',borderRadius:'8px',boxShadow:'0 6px 18px rgba(2,6,23,.3)',zIndex:9999});
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    setTimeout(()=>{ t.style.transition = 'opacity 400ms'; t.style.opacity = '0'; }, 1800);
  }