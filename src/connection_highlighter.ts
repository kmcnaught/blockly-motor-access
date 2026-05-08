/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BlockSvg,
  RenderedConnection,
  WorkspaceSvg,
  utils,
  ConnectionType,
} from 'blockly';

/** Maximum number of connections to highlight for performance. */
const MAX_HIGHLIGHTED_CONNECTIONS = 50;

/** Delay in milliseconds before retrying DOM insertion for highlights. */
const HIGHLIGHT_RETRY_DELAY_MS = 10;

/**
 * Represents a valid connection pair between a moving block and a target.
 */
export interface ValidConnection {
  /** A connection on the dragging block that can connect. */
  local: RenderedConnection;
  /** A connection on the workspace that can accept the local connection. */
  neighbour: RenderedConnection;
  /** The distance between the connections (for sorting/filtering). */
  distance: number;
}

/**
 * Manages visual highlighting of valid connection points during block moves.
 * Provides visual feedback showing all possible destinations for a moving block.
 */
export class ConnectionHighlighter {
  /** Set of DOM elements that have highlighting applied. */
  private highlightedElements: Set<Element> = new Set();

  /** Map from highlight elements to their corresponding connections. */
  private elementToConnection: WeakMap<Element, RenderedConnection> =
    new WeakMap();

  /** Map from highlight elements to their original connection coordinates for updating. */
  private elementToOriginalCoords: WeakMap<
    Element,
    {connection: RenderedConnection; type: string}
  > = new WeakMap();

  /** The workspace this highlighter is operating on. */
  private workspace: WorkspaceSvg;

  /** Callback for handling connection clicks. */
  private onConnectionClick?: (connection: RenderedConnection) => void;

  /** Scroll event listener for updating highlight positions. */
  private scrollListener?: () => void;

  /** Connection highlight size: minimal, medium, or large. */
  private connectionSize: 'minimal' | 'medium' | 'large' = 'medium';

  /**
   * Whether ancestor connections visually overlap descendant connections in this renderer.
   * True for Zelos (connections overlap), false for Geras/Thrasos (connections don't overlap).
   */
  private ancestorConnectionsOverlap: boolean;

  /** Separate SVG group layer for all highlights, rendered on top of blocks. */
  private highlightLayer: SVGGElement | null = null;

  /** Set of blocks that have highlights, used to detect overlapping descendants. */
  private highlightedBlocks: Set<BlockSvg> = new Set();

  constructor(
    workspace: WorkspaceSvg,
    onConnectionClick?: (connection: RenderedConnection) => void,
  ) {
    this.workspace = workspace;
    this.onConnectionClick = onConnectionClick;

    // Zelos: ancestor connections visually overlap descendants
    // Geras/Thrasos: connections render side-by-side without overlapping
    const rendererName = workspace.getRenderer().constructor.name.toLowerCase();
    this.ancestorConnectionsOverlap = rendererName.includes('zelos');

    this.scrollListener = () => {
      this.updateHighlights();
    };

    // Create a separate highlight layer at workspace level
    this.createHighlightLayer();
  }

  /**
   * Creates a dedicated SVG layer for highlights that renders on top of all blocks.
   */
  private createHighlightLayer(): void {
    // Append to parent SVG (above workspace group) to avoid coordinate transform issues
    const parentSvg = this.workspace.getParentSvg();
    if (parentSvg) {
      this.highlightLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      this.highlightLayer.setAttribute('class', 'blocklyConnectionHighlightLayer');
      parentSvg.appendChild(this.highlightLayer);
    }
  }

  /**
   * Enable or disable fatter connection highlights.
   * Kept for backwards compatibility.
   *
   * @param enabled Whether to use fatter connections with larger click targets.
   */
  setFatterConnections(enabled: boolean): void {
    this.connectionSize = enabled ? 'medium' : 'minimal';
  }

  /**
   * Set the connection highlight size.
   *
   * @param size The size level: 'minimal', 'medium', or 'large'.
   */
  setConnectionSize(size: 'minimal' | 'medium' | 'large'): void {
    this.connectionSize = size;
  }

  /**
   * Highlights all valid connection points for the given moving block.
   *
   * @param movingBlock The block being moved.
   * @param allConnections All available connections on the workspace.
   * @param localConnections Connections available on the moving block.
   */
  highlightValidConnections(
    movingBlock: BlockSvg,
    allConnections: RenderedConnection[],
    localConnections: RenderedConnection[],
  ): ValidConnection[] {
    this.clearHighlights();

    const validConnections = this.findAllValidConnections(
      movingBlock,
      allConnections,
      localConnections,
    );

    // Apply visual highlighting to each valid connection
    // Sort by AST depth (parents first) so child highlights are added after and render on top
    const validConnectionsSorted = validConnections.sort((a, b) => {
      const depthA = this.getBlockDepth(a.neighbour.getSourceBlock());
      const depthB = this.getBlockDepth(b.neighbour.getSourceBlock());
      // Render shallower blocks first, then deeper blocks (child highlights added last)
      return depthA - depthB;
    });

    for (const validConnection of validConnectionsSorted) {
      const sourceBlock = validConnection.neighbour.getSourceBlock();
      if (!(sourceBlock instanceof BlockSvg)) continue;

      // Check if any ancestor block already has a highlight
      const hasAncestorHighlight = this.hasAncestorWithHighlight(sourceBlock);

      // Create the highlight (fully transparent if ancestor has one)
      this.highlightConnection(validConnection.neighbour, hasAncestorHighlight);

      // Track this block as having a highlight
      this.highlightedBlocks.add(sourceBlock);
    }

    // Update highlight positions when workspace scrolls
    if (this.scrollListener) {
      const svgGroup = this.workspace.getSvgGroup();
      if (svgGroup) {
        this.workspace.addChangeListener(this.scrollListener);
      }
    }

    return validConnections;
  }

  /**
   * Finds all valid connections between the moving block and workspace connections.
   *
   * @param movingBlock The block being moved.
   * @param allConnections All available connections on the workspace.
   * @param localConnections Connections available on the moving block.
   * @returns Array of valid connection pairs.
   */
  private findAllValidConnections(
    movingBlock: BlockSvg,
    allConnections: RenderedConnection[],
    localConnections: RenderedConnection[],
  ): ValidConnection[] {
    const validConnections: ValidConnection[] = [];
    const connectionChecker = movingBlock.workspace.connectionChecker;

    for (const localConn of localConnections) {
      for (const potentialNeighbour of allConnections) {
        // Skip connections on the moving block itself or its descendants
        if (this.getFilterReason(potentialNeighbour, movingBlock)) {
          continue;
        }

        // Skip connections already occupied by the moving block
        // (e.g., a color value block already in the moving block's color input)
        if (potentialNeighbour.targetConnection &&
            localConnections.includes(potentialNeighbour.targetConnection as RenderedConnection)) {
          continue;
        }

        // Only highlight where the moving block can attach TO other blocks,
        // not where other blocks would insert INTO the moving block's inputs.
        // Valid: OUTPUT→INPUT, PREVIOUS→NEXT, NEXT→PREVIOUS
        const isValidDirection =
          (localConn.type === ConnectionType.OUTPUT_VALUE &&
           potentialNeighbour.type === ConnectionType.INPUT_VALUE) ||
          (localConn.type === ConnectionType.PREVIOUS_STATEMENT &&
           potentialNeighbour.type === ConnectionType.NEXT_STATEMENT) ||
          (localConn.type === ConnectionType.NEXT_STATEMENT &&
           potentialNeighbour.type === ConnectionType.PREVIOUS_STATEMENT);

        if (!isValidDirection) {
          continue;
        }

        // Check type compatibility and add to results
        if (connectionChecker.canConnect(localConn, potentialNeighbour, true, Infinity)) {
          validConnections.push({
            local: localConn,
            neighbour: potentialNeighbour,
            distance: this.calculateDistance(localConn, potentialNeighbour),
          });
        }
      }
    }

    // Sort by distance and limit for performance.
    // Use stable sort to preserve spatial ordering when distances are equal.
    // We track original indices to guarantee stability across all JS engines.
    const indexed = validConnections.map((conn, index) => ({conn, index}));
    indexed.sort((a, b) => {
      const distanceDiff = a.conn.distance - b.conn.distance;
      // If distances differ, sort by distance (closer connections first)
      if (distanceDiff !== 0) return distanceDiff;
      // If distances are equal, preserve original order from allConnections
      return a.index - b.index;
    });

    return indexed.slice(0, MAX_HIGHLIGHTED_CONNECTIONS).map(item => item.conn);
  }

  /**
   * Applies visual highlighting to a single connection.
   *
   * @param connection The connection to highlight.
   * @param isOverlapping Whether this connection overlaps with an ancestor connection.
   */
  private highlightConnection(connection: RenderedConnection, isOverlapping: boolean = false) {
    try {
      this.createConnectionVisualization(connection, isOverlapping);
    } catch (error) {
      console.debug('Failed to highlight connection (non-critical):', error);
    }
  }

  /**
   * Creates connection-type-appropriate visual highlight.
   *
   * @param connection The connection to create a highlight for.
   * @param isOverlapping Whether this connection overlaps with an ancestor connection.
   */
  private createConnectionVisualization(connection: RenderedConnection, isOverlapping: boolean = false) {
    const sourceBlock = connection.getSourceBlock();
    if (!(sourceBlock instanceof BlockSvg)) return;

    const workspace = sourceBlock.workspace;
    const svgGroup = workspace.getSvgGroup();
    if (!svgGroup) return;

    let highlight: SVGElement;

    switch (connection.type) {
      case ConnectionType.PREVIOUS_STATEMENT:
      case ConnectionType.NEXT_STATEMENT:
        highlight = this.createStatementNotch(connection, workspace, isOverlapping);
        break;

      case ConnectionType.INPUT_VALUE:
      case ConnectionType.OUTPUT_VALUE:
        highlight = this.createValueOutline(connection, workspace, isOverlapping);
        break;

      default:
        return;
    }

    if (highlight) {
      // Store metadata for click handling
      highlight.setAttribute('data-connection-x', connection.x.toString());
      highlight.setAttribute('data-connection-y', connection.y.toString());
      highlight.setAttribute(
        'data-connection-type',
        connection.type.toString(),
      );

      this.elementToConnection.set(highlight, connection);
      this.elementToOriginalCoords.set(highlight, {
        connection: connection,
        type: highlight.tagName.toLowerCase(),
      });

      // Enable connection selection via click
      if (this.onConnectionClick) {
        const clickHandler = (event: Event) => {
          event.stopPropagation();
          this.onConnectionClick!(connection);
        };
        highlight.addEventListener('click', clickHandler);
        highlight.addEventListener('pointerdown', clickHandler);
      }
    }
  }

  /**
   * Creates a notch-style highlight for statement connections.
   * Attached to block's SVG to follow block movement during stack rearrangement.
   *
   * @param connection The statement connection to highlight.
   * @param workspace The workspace for coordinate transformation.
   * @param isOverlapping Whether this connection overlaps with an ancestor connection.
   * @returns The SVG element representing the notch.
   */
  private createStatementNotch(
    connection: RenderedConnection,
    workspace: WorkspaceSvg,
    isOverlapping: boolean = false,
  ): SVGElement {
    const sourceBlock = connection.getSourceBlock();
    if (!(sourceBlock instanceof BlockSvg)) {
      throw new Error('Source block is not a BlockSvg');
    }

    const renderer = sourceBlock.workspace.getRenderer();
    const constants = renderer.getConstants();
    const connectionShape = constants.shapeFor(connection);

    if (!connectionShape || !(connectionShape as any).pathLeft) {
      throw new Error('No connection shape available');
    }

    const xLen = constants.NOTCH_OFFSET_LEFT - constants.CORNER_RADIUS;
    const pathLeft = (connectionShape as any).pathLeft;
    const notchWidth = (connectionShape as any).width;

    let highlightPath: string;

    if (this.connectionSize === 'minimal') {
      // Minimal: simple notch outline
      highlightPath = (
        `M ${-xLen} 0 ` +
        `h ${xLen} ` +
        pathLeft +
        `h ${xLen}`
      );
    } else {
      // Medium/Large: flat-top, notched-bottom shape for larger click target
      const verticalPadding = this.connectionSize === 'large' ? 10 : 5;

      highlightPath = (
        `M ${-xLen} ${-verticalPadding} ` +           // Start top-left
        `v ${verticalPadding * 2} ` +                 // Go down left side
        `h ${xLen} ` +                                // Go right to notch start (x=0)
        pathLeft +                                    // Draw notch at bottom
        `h ${xLen} ` +                                // Go right from notch end
        `v ${-(verticalPadding * 2)} ` +              // Go up right side
        `h ${-(notchWidth + xLen * 2)} ` +            // Go left across top back to start
        `Z`                                           // Close path
      );
    }

    const highlightSvg = document.createElementNS('http://www.w3.org/2000/svg', 'path');

    // Transform workspace coordinates to SVG coordinates (highlight layer is at parent SVG level)
    const coords = this.transformCoordinates(connection.x, connection.y, workspace);
    const scale = workspace.scale;
    const scaleTransform = sourceBlock.RTL ? ` scale(${-scale} ${scale})` : ` scale(${scale})`;
    const transformation = `translate(${coords.x}, ${coords.y})${scaleTransform}`;

    highlightSvg.setAttribute('d', highlightPath);
    highlightSvg.setAttribute('transform', transformation);

    if (isOverlapping && this.ancestorConnectionsOverlap) {
      highlightSvg.setAttribute('fill', 'rgba(0, 255, 0, 0)');
    } else {
      highlightSvg.setAttribute('fill', 'rgba(0, 255, 0, 0.7)');
    }

    highlightSvg.setAttribute('stroke-width', '2.5');
    highlightSvg.setAttribute('stroke-linejoin', 'round');
    highlightSvg.setAttribute('stroke-linecap', 'round');
    highlightSvg.setAttribute('class', 'blocklyPotentialConnection');
    highlightSvg.style.pointerEvents = 'auto';
    highlightSvg.style.cursor = 'pointer';

    // Add to workspace highlight layer
    if (this.highlightLayer) {
      this.highlightLayer.appendChild(highlightSvg);
      this.highlightedElements.add(highlightSvg);
    }

    return highlightSvg;
  }

  /**
   * Creates a value connection highlight using the renderer's puzzle tab shape.
   * Manages SVG independently to avoid core rendering lifecycle interference.
   *
   * @param connection The value connection to highlight.
   * @param sourceBlock The block containing the connection.
   * @param isOverlapping Whether this connection overlaps with an ancestor connection.
   * @returns The SVG element created, or null if unsuccessful.
   */
  private createCoreBasedValueHighlight(
    connection: RenderedConnection,
    sourceBlock: BlockSvg,
    isOverlapping: boolean = false,
  ): SVGElement | null {
    try {
      const renderer = sourceBlock.workspace.getRenderer();
      const constants = renderer.getConstants();

      const connectionShape = constants.shapeFor(connection);
      if (!connectionShape) {
        return null;
      }

      let connPath = '';
      let measurableHeight = constants.TAB_HEIGHT;

      if ((connectionShape as any).isDynamic) {
        const renderInfo = (sourceBlock as any).renderInfo_;
        if (renderInfo) {
          const connectionMeasurable = this.findConnectionMeasurable(connection, renderInfo);
          if (connectionMeasurable && connectionMeasurable.height) {
            measurableHeight = connectionMeasurable.height;
          }
        }

        connPath = (connectionShape as any).pathDown(measurableHeight);
      } else if ((connectionShape as any).pathDown) {
        connPath = (connectionShape as any).pathDown;
      } else {
        return null;
      }

      const yLen = constants.TAB_OFFSET_FROM_TOP;

      let highlightPath: string;
      if (this.connectionSize === 'minimal') {
        // Minimal: standard thin outline
        highlightPath = (
          `M 0 ${-yLen} ` +
          `v ${yLen} ` +
          connPath +
          `v ${yLen}`
        );
      } else {
        // Medium/Large: puzzle tab on left, rectangular extension to right
        // Size to fit within an empty connection socket (similar to puzzle tab width)
        const tabWidth = (connectionShape as any).width || constants.TAB_WIDTH || 8;
        const rightPadding = this.connectionSize === 'large' ? tabWidth * 1.5 : tabWidth;
        const totalHeight = yLen * 2 + measurableHeight;

        highlightPath = (
          `M 0 ${-yLen} ` +              // Start above connection
          `v ${yLen} ` +                  // Down to connection point
          connPath +                      // Draw the puzzle tab (left side)
          `v ${yLen} ` +                  // Down to bottom-left
          `h ${rightPadding} ` +          // Right to bottom-right (fits empty socket)
          `v ${-totalHeight} ` +          // Up to top-right
          `h ${-rightPadding} ` +         // Left back to top-left
          `Z`                             // Close the shape
        );
      }

      const highlightSvg = document.createElementNS('http://www.w3.org/2000/svg', 'path');

      // Transform workspace coordinates to SVG coordinates (highlight layer is at parent SVG level)
      const coords = this.transformCoordinates(connection.x, connection.y, this.workspace);
      const scale = this.workspace.scale;
      const scaleTransform = sourceBlock.RTL ? ` scale(${-scale} ${scale})` : ` scale(${scale})`;
      const transformation = `translate(${coords.x}, ${coords.y})${scaleTransform}`;

      highlightSvg.setAttribute('d', highlightPath);
      highlightSvg.setAttribute('transform', transformation);

      if (isOverlapping && this.ancestorConnectionsOverlap) {
        highlightSvg.setAttribute('fill', 'rgba(0, 255, 0, 0)');
      } else {
        highlightSvg.setAttribute('fill', 'rgba(0, 255, 0, 0.7)');
      }

      highlightSvg.setAttribute('stroke-width', '8');
      highlightSvg.setAttribute('class', 'blocklyPotentialConnection');
      highlightSvg.style.pointerEvents = 'auto';
      highlightSvg.style.cursor = 'pointer';

      // Add to workspace highlight layer
      if (this.highlightLayer) {
        this.highlightLayer.appendChild(highlightSvg);

        this.highlightedElements.add(highlightSvg);
        this.elementToConnection.set(highlightSvg, connection);
        this.elementToOriginalCoords.set(highlightSvg, {
          connection: connection,
          type: 'path',
        });

        if (this.onConnectionClick) {
          const clickHandler = (event: Event) => {
            event.stopPropagation();
            this.onConnectionClick!(connection);
          };
          highlightSvg.addEventListener('click', clickHandler);
          highlightSvg.addEventListener('pointerdown', clickHandler);
        }

        return highlightSvg;
      }

    } catch (error) {
      console.debug('Failed to create core-based value highlight, using fallback:', error);
    }

    return null;
  }

  /**
   * Finds the connection measurable object from render info that corresponds to the given connection.
   *
   * @param connection The rendered connection to find.
   * @param renderInfo The block's render info.
   * @returns The connection measurable, or null if not found.
   */
  private findConnectionMeasurable(connection: RenderedConnection, renderInfo: any): any {
    if (!renderInfo || !renderInfo.rows) {
      return null;
    }

    // Search through all rows and elements to find the matching connection
    for (const row of renderInfo.rows) {
      if (row.elements) {
        for (const element of row.elements) {
          if (element.connectionModel === connection) {
            return element;
          }
        }
      }
    }

    return null;
  }

  /**
   * Creates an outline highlight for value connections.
   * Uses renderer-based shapes for Geras/Thrasos, falls back to rounded rect for Zelos.
   *
   * @param connection The value connection to highlight.
   * @param workspace The workspace for coordinate transformation.
   * @param isOverlapping Whether this connection overlaps with an ancestor connection.
   * @returns The SVG element representing the value outline.
   */
  private createValueOutline(
    connection: RenderedConnection,
    workspace: WorkspaceSvg,
    isOverlapping: boolean = false,
  ): SVGElement {
    const sourceBlock = connection.getSourceBlock();
    if (sourceBlock instanceof BlockSvg) {
      const renderer = sourceBlock.workspace.getRenderer();
      const rendererName = renderer.constructor.name;
      const isZelos = rendererName.toLowerCase().includes('zelos');

      // Use core shapes for Geras/Thrasos (Zelos requires unavailable renderInfo)
      if (!isZelos) {
        const shapeHighlight = this.createCoreBasedValueHighlight(connection, sourceBlock, isOverlapping);
        if (shapeHighlight) {
          shapeHighlight.setAttribute('data-already-in-dom', 'true');
          return shapeHighlight;
        }
      }
    }

    // Fallback rounded rect for Zelos or if core shapes unavailable
    // Add to workspace highlight layer for proper z-order
    const socketBounds = this.getActualSocketBounds(connection, workspace);
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');

    // Transform workspace coordinates to SVG coordinates (highlight layer is at parent SVG level)
    if (sourceBlock instanceof BlockSvg) {
      const coords = this.transformCoordinates(socketBounds.x, socketBounds.y, workspace);
      const scale = workspace.scale;
      const cornerRadius = Math.min(socketBounds.height / 2, 25);

      rect.setAttribute('x', coords.x.toString());
      rect.setAttribute('y', coords.y.toString());
      rect.setAttribute('width', (socketBounds.width * scale).toString());
      rect.setAttribute('height', (socketBounds.height * scale).toString());
      rect.setAttribute('rx', cornerRadius.toString());
      rect.setAttribute('ry', cornerRadius.toString());

      if (isOverlapping && this.ancestorConnectionsOverlap) {
        rect.setAttribute('fill', 'rgba(0, 255, 0, 0)');
      } else {
        rect.setAttribute('fill', 'rgba(0, 255, 0, 0.7)');
      }

      rect.setAttribute('stroke-width', '6');
      rect.setAttribute('stroke-dasharray', '3,3');
      rect.setAttribute('class', 'blocklyPotentialConnection');
      rect.style.pointerEvents = 'auto';
      rect.style.cursor = 'pointer';

      // Add to workspace highlight layer
      if (this.highlightLayer) {
        this.highlightLayer.appendChild(rect);

        this.highlightedElements.add(rect);
        this.elementToConnection.set(rect, connection);
        this.elementToOriginalCoords.set(rect, {
          connection: connection,
          type: 'rect',
        });

        if (this.onConnectionClick) {
          const clickHandler = (event: Event) => {
            event.stopPropagation();
            this.onConnectionClick!(connection);
          };
          rect.addEventListener('click', clickHandler);
          rect.addEventListener('pointerdown', clickHandler);
        }

        return rect;
      }
    }

    // Fallback if highlight layer not available
    throw new Error('Failed to add rect highlight to workspace layer');
  }

  /**
   * Gets bounds for socket contents or reasonable defaults.
   *
   * @param connection The value connection to analyze.
   * @param workspace The workspace for coordinate reference.
   * @returns Bounds object with x, y, width, height.
   */
  private getActualSocketBounds(
    connection: RenderedConnection,
    workspace: WorkspaceSvg,
  ): {x: number; y: number; width: number; height: number} {
    try {
      const targetBlock = connection.targetBlock();
      if (targetBlock && targetBlock instanceof BlockSvg) {
        const blockBounds = targetBlock.getBoundingRectangle();
        return {
          x: blockBounds.left,
          y: blockBounds.top,
          width: blockBounds.right - blockBounds.left,
          height: blockBounds.bottom - blockBounds.top,
        };
      }

      const shadowBlock = connection.getShadowDom();
      if (shadowBlock && connection.targetConnection) {
        const shadowTargetBlock = connection.targetConnection.getSourceBlock();
        if (shadowTargetBlock && shadowTargetBlock instanceof BlockSvg) {
          const shadowBounds = shadowTargetBlock.getBoundingRectangle();
          return {
            x: shadowBounds.left,
            y: shadowBounds.top,
            width: shadowBounds.right - shadowBounds.left,
            height: shadowBounds.bottom - shadowBounds.top,
          };
        }
      }

      const sourceBlock = connection.getSourceBlock();
      if (sourceBlock && sourceBlock instanceof BlockSvg) {
        const input = this.findInputForConnection(sourceBlock, connection);
        if (input) {
          const estimatedBounds = this.estimateInputBounds(input, connection);
          if (estimatedBounds) {
            return estimatedBounds;
          }
        }
      }

      return {
        x: connection.x,
        y: connection.y - 15,
        width: 80,
        height: 30,
      };
    } catch (error) {
      console.debug('Failed to get socket bounds, using defaults:', error);
      return {
        x: connection.x,
        y: connection.y - 15,
        width: 80,
        height: 30,
      };
    }
  }

  /**
   * Finds the input that contains the given connection.
   *
   * @param block The block to search.
   * @param connection The connection to find.
   * @returns The input containing the connection, or null.
   */
  private findInputForConnection(
    block: BlockSvg,
    connection: RenderedConnection,
  ): any {
    const inputs = block.inputList;
    for (const input of inputs) {
      if (input.connection === connection) {
        return input;
      }
    }
    return null;
  }

  /**
   * Estimates bounds for an input based on field content.
   *
   * @param input The input to estimate bounds for.
   * @param connection The connection for positioning reference.
   * @returns Estimated bounds or null if cannot determine.
   */
  private estimateInputBounds(
    input: any,
    connection: RenderedConnection,
  ): {x: number; y: number; width: number; height: number} | null {
    try {
      if (input.fieldRow && input.fieldRow.length > 0) {
        let totalWidth = 0;
        const maxHeight = 30;

        for (const field of input.fieldRow) {
          if (field.getText) {
            const text = field.getText();
            const fieldWidth = Math.max(text.length * 8 + 20, 40);
            totalWidth += fieldWidth;
          } else {
            totalWidth += 40;
          }
        }

        return {
          x: connection.x,
          y: connection.y - maxHeight / 2,
          width: totalWidth,
          height: maxHeight,
        };
      }

      return null;
    } catch (error) {
      console.debug('Failed to estimate input bounds:', error);
      return null;
    }
  }

  /**
   * Transforms workspace coordinates to SVG coordinates.
   *
   * @param x Workspace x coordinate.
   * @param y Workspace y coordinate.
   * @param workspace The workspace for transformation parameters.
   * @returns Transformed coordinates.
   */
  private transformCoordinates(
    x: number,
    y: number,
    workspace: WorkspaceSvg,
  ): {x: number; y: number} {
    const scale = workspace.scale;
    const translation = workspace.getOriginOffsetInPixels();

    return {
      x: x * scale + translation.x,
      y: y * scale + translation.y,
    };
  }

  /**
   * Returns why a connection should be filtered, or null if valid.
   *
   * @param connection The connection to check.
   * @param movingBlock The block being moved.
   * @returns The filter reason string, or null if not filtered.
   */
  private getFilterReason(
    connection: RenderedConnection,
    movingBlock: BlockSvg,
  ): string | null {
    const sourceBlock = connection.getSourceBlock();
    if (!sourceBlock) return 'no-source-block';

    if (sourceBlock.isInsertionMarker()) return 'insertion-marker';

    // Filter out connections that would require moving an immoveable block
    // Case 1: PREVIOUS/OUTPUT connections on immoveable blocks (inserting before would push them)
    if (
      !sourceBlock.isMovable() &&
      (connection.type === ConnectionType.PREVIOUS_STATEMENT ||
        connection.type === ConnectionType.OUTPUT_VALUE)
    ) {
      return 'immoveable-block-source';
    }

    // Case 2: NEXT/INPUT connections that are already occupied by immoveable blocks
    // (inserting would push the immoveable target aside)
    const targetConnection = connection.targetConnection;
    if (targetConnection) {
      const targetBlock = targetConnection.getSourceBlock();
      if (targetBlock && !targetBlock.isMovable()) {
        if (
          connection.type === ConnectionType.NEXT_STATEMENT ||
          connection.type === ConnectionType.INPUT_VALUE
        ) {
          return 'immoveable-block-target';
        }
      }
    }

    if (sourceBlock === movingBlock) return 'moving-block';

    // Include all descendants including input value blocks (true parameter)
    // This prevents highlighting connections on blocks inside the moving block's inputs
    const movingDescendants = movingBlock.getDescendants(true);
    if (movingDescendants.includes(sourceBlock as BlockSvg)) {
      return 'moving-block-descendant';
    }

    return null;
  }

  /**
   * Checks if connection should be filtered (on moving block or preview).
   *
   * @param connection The connection to check.
   * @param movingBlock The block being moved.
   * @returns True if the connection should be filtered out.
   */
  private isConnectionOnMovingBlock(
    connection: RenderedConnection,
    movingBlock: BlockSvg,
  ): boolean {
    return this.getFilterReason(connection, movingBlock) !== null;
  }

  /**
   * Calculates the distance between two connections.
   *
   * @param conn1 First connection.
   * @param conn2 Second connection.
   * @returns The distance between the connections.
   */
  private calculateDistance(
    conn1: RenderedConnection,
    conn2: RenderedConnection,
  ): number {
    const dx = conn1.x - conn2.x;
    const dy = conn1.y - conn2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Calculates the depth of a block in the AST (how many parents it has).
   * Top-level blocks have depth 0, their children have depth 1, etc.
   *
   * @param block The block to measure depth for.
   * @returns The depth of the block in the tree.
   */
  private getBlockDepth(block: BlockSvg | null): number {
    if (!block) return 0;

    let depth = 0;
    let current = block;

    // Walk up the parent chain counting levels
    while (current) {
      const parent = current.getParent();
      if (!parent) break;
      depth++;
      current = parent as BlockSvg;
    }

    return depth;
  }

  /**
   * Checks if any ancestor block has a highlight.
   * Only follows OUTPUT→INPUT value connection chains, not statement chains.
   * Used to make descendant highlights transparent to avoid visual clutter.
   *
   * @param block The block to check.
   * @returns True if any value parent has a highlight.
   */
  private hasAncestorWithHighlight(block: BlockSvg): boolean {
    let current = block;

    // Only follow value parent chain (blocks connected via OUTPUT/INPUT)
    while (current) {
      const outputConnection = current.outputConnection;
      if (!outputConnection || !outputConnection.isConnected()) {
        // No output connection or not connected, stop searching
        break;
      }

      // Get the parent block this output is connected to
      const targetConnection = outputConnection.targetConnection;
      if (!targetConnection) break;

      const parent = targetConnection.getSourceBlock();
      if (!parent || !(parent instanceof BlockSvg)) break;

      // Check if this parent has a highlight
      if (this.highlightedBlocks.has(parent)) {
        return true;
      }

      // Continue up the value parent chain
      current = parent;
    }

    return false;
  }

  /**
   * Removes all connection highlighting.
   */
  clearHighlights(): void {
    if (this.scrollListener) {
      this.workspace.removeChangeListener(this.scrollListener);
    }

    for (const element of this.highlightedElements) {
      try {
        if (element instanceof SVGElement) {
          element.remove();
        } else if (element.parentNode) {
          element.parentNode.removeChild(element);
        }
      } catch (error) {
        // Silently fail - element may have already been removed
      }
    }

    this.highlightedElements.clear();
    this.highlightedBlocks.clear();
  }

  /**
   * Updates highlight positions based on workspace scroll and zoom.
   */
  updateHighlights(): void {
    for (const element of this.highlightedElements) {
      const coordsInfo = this.elementToOriginalCoords.get(element);
      if (!coordsInfo) continue;

      const {connection, type} = coordsInfo;

      try {
        switch (type) {
          case 'circle':
            this.updateCirclePosition(element as SVGCircleElement, connection);
            break;
          case 'path':
            this.updatePathPosition(element as SVGPathElement, connection);
            break;
          case 'rect':
            this.updateRectPosition(element as SVGRectElement, connection);
            break;
        }
      } catch (error) {
        console.debug('Failed to update highlight position:', error);
      }
    }
  }

  /**
   * Updates the position of a circle highlight element.
   *
   * @param circle The circle element to update.
   * @param connection The connection this circle represents.
   */
  private updateCirclePosition(
    circle: SVGCircleElement,
    connection: RenderedConnection,
  ): void {
    const coords = this.transformCoordinates(
      connection.x,
      connection.y,
      this.workspace,
    );
    circle.setAttribute('cx', coords.x.toString());
    circle.setAttribute('cy', coords.y.toString());
  }

  /**
   * Updates the position of a path highlight element.
   * Paths are in the highlight layer at parent SVG level.
   *
   * @param path The path element to update.
   * @param connection The connection this path represents.
   */
  private updatePathPosition(
    path: SVGPathElement,
    connection: RenderedConnection,
  ): void {
    const sourceBlock = connection.getSourceBlock();
    if (!(sourceBlock instanceof BlockSvg)) return;

    // Transform workspace coordinates to SVG coordinates
    const coords = this.transformCoordinates(connection.x, connection.y, this.workspace);
    const scale = this.workspace.scale;
    const scaleTransform = sourceBlock.RTL ? ` scale(${-scale} ${scale})` : ` scale(${scale})`;
    const transformation = `translate(${coords.x}, ${coords.y})${scaleTransform}`;
    path.setAttribute('transform', transformation);
  }

  /**
   * Updates the position of a rect highlight (value connections).
   * Rects are in the highlight layer at parent SVG level.
   *
   * @param rect The rect element to update.
   * @param connection The connection this rect represents.
   */
  private updateRectPosition(
    rect: SVGRectElement,
    connection: RenderedConnection,
  ): void {
    const socketBounds = this.getActualSocketBounds(connection, this.workspace);
    const coords = this.transformCoordinates(socketBounds.x, socketBounds.y, this.workspace);
    const scale = this.workspace.scale;

    rect.setAttribute('x', coords.x.toString());
    rect.setAttribute('y', coords.y.toString());
    rect.setAttribute('width', (socketBounds.width * scale).toString());
    rect.setAttribute('height', (socketBounds.height * scale).toString());
  }

  /**
   * Checks if a point (in screen coordinates) intersects with any highlighted connection.
   *
   * @param screenX Screen X coordinate.
   * @param screenY Screen Y coordinate.
   * @returns The connection at the point, or null if no connection found.
   */
  findConnectionAtPoint(screenX: number, screenY: number): RenderedConnection | null {
    for (const element of this.highlightedElements) {
      const bounds = element.getBoundingClientRect();
      if (screenX >= bounds.left && screenX <= bounds.right &&
          screenY >= bounds.top && screenY <= bounds.bottom) {
        const connection = this.elementToConnection.get(element);
        if (connection) {
          return connection;
        }
      }
    }
    return null;
  }

  /**
   * Gets bounding boxes for all currently highlighted connections.
   *
   * @returns Array of connection bounds information.
   */
  getHighlightedConnectionBounds(): Array<{
    connection: RenderedConnection;
    bounds: DOMRect;
    element: Element;
  }> {
    const results: Array<{connection: RenderedConnection; bounds: DOMRect; element: Element}> = [];

    for (const element of this.highlightedElements) {
      const connection = this.elementToConnection.get(element);
      if (connection) {
        const bounds = element.getBoundingClientRect();
        results.push({
          connection,
          bounds,
          element
        });
      }
    }

    return results;
  }

  /**
   * Disposes of the highlighter and cleans up all resources.
   */
  dispose(): void {
    this.clearHighlights();

    // Remove the highlight layer
    if (this.highlightLayer && this.highlightLayer.parentNode) {
      this.highlightLayer.parentNode.removeChild(this.highlightLayer);
      this.highlightLayer = null;
    }
  }

  /**
   * Highlights valid connection points for a flyout block that hasn't been
   * placed on the workspace yet. This enables "preview then place" mode where
   * the user sees where a block can go before actually creating it.
   *
   * @param flyoutBlock The block in the flyout to find placement options for.
   * @param targetWorkspace The main workspace to show highlights on.
   * @returns Array of valid connection pairs.
   */
  highlightConnectionsForFlyoutBlock(
    flyoutBlock: BlockSvg,
    targetWorkspace: WorkspaceSvg,
  ): ValidConnection[] {
    this.clearHighlights();

    // Get connections from the flyout block
    const flyoutConnections = flyoutBlock.getConnections_(false);
    if (flyoutConnections.length === 0) {
      return [];
    }

    // Get all connections on the target workspace by iterating all blocks
    const allWorkspaceConnections = targetWorkspace
      .getAllBlocks(false)
      .flatMap((block) => (block as BlockSvg).getConnections_(false) as RenderedConnection[]);

    // Find compatible connections
    const validConnections = this.findCompatibleConnectionsForFlyoutBlock(
      flyoutBlock,
      flyoutConnections as RenderedConnection[],
      allWorkspaceConnections,
      targetWorkspace,
    );

    // Apply visual highlighting
    const validConnectionsSorted = validConnections.sort((a, b) => {
      const depthA = this.getBlockDepth(a.neighbour.getSourceBlock());
      const depthB = this.getBlockDepth(b.neighbour.getSourceBlock());
      return depthA - depthB;
    });

    for (const validConnection of validConnectionsSorted) {
      const sourceBlock = validConnection.neighbour.getSourceBlock();
      if (!(sourceBlock instanceof BlockSvg)) continue;

      const hasAncestorHighlight = this.hasAncestorWithHighlight(sourceBlock);
      this.highlightConnection(validConnection.neighbour, hasAncestorHighlight);
      this.highlightedBlocks.add(sourceBlock);
    }

    // Update highlight positions when workspace scrolls
    if (this.scrollListener) {
      targetWorkspace.addChangeListener(this.scrollListener);
    }

    return validConnections;
  }

  /**
   * Finds compatible connections on the target workspace for a flyout block.
   *
   * @param flyoutBlock The flyout block to find placements for.
   * @param flyoutConnections Connections on the flyout block.
   * @param workspaceConnections All connections on the target workspace.
   * @param targetWorkspace The target workspace.
   * @returns Array of valid connection pairs.
   */
  private findCompatibleConnectionsForFlyoutBlock(
    flyoutBlock: BlockSvg,
    flyoutConnections: RenderedConnection[],
    workspaceConnections: RenderedConnection[],
    targetWorkspace: WorkspaceSvg,
  ): ValidConnection[] {
    const validConnections: ValidConnection[] = [];
    const connectionChecker = targetWorkspace.connectionChecker;

    for (const flyoutConn of flyoutConnections) {
      for (const workspaceConn of workspaceConnections) {
        // Skip insertion markers and immovable blocks
        const sourceBlock = workspaceConn.getSourceBlock();
        if (!sourceBlock || sourceBlock.isInsertionMarker()) {
          continue;
        }

        // Skip connections that would require moving an immovable block
        if (
          !sourceBlock.isMovable() &&
          (workspaceConn.type === ConnectionType.PREVIOUS_STATEMENT ||
            workspaceConn.type === ConnectionType.OUTPUT_VALUE)
        ) {
          continue;
        }

        // Check if occupied by immovable block
        const targetConnection = workspaceConn.targetConnection;
        if (targetConnection) {
          const targetBlock = targetConnection.getSourceBlock();
          if (targetBlock && !targetBlock.isMovable()) {
            if (
              workspaceConn.type === ConnectionType.NEXT_STATEMENT ||
              workspaceConn.type === ConnectionType.INPUT_VALUE
            ) {
              continue;
            }
          }
        }

        // Only highlight where the flyout block can attach TO other blocks
        const isValidDirection =
          (flyoutConn.type === ConnectionType.OUTPUT_VALUE &&
            workspaceConn.type === ConnectionType.INPUT_VALUE) ||
          (flyoutConn.type === ConnectionType.PREVIOUS_STATEMENT &&
            workspaceConn.type === ConnectionType.NEXT_STATEMENT) ||
          (flyoutConn.type === ConnectionType.NEXT_STATEMENT &&
            workspaceConn.type === ConnectionType.PREVIOUS_STATEMENT);

        if (!isValidDirection) {
          continue;
        }

        // Check type compatibility
        if (connectionChecker.canConnect(flyoutConn, workspaceConn, true, Infinity)) {
          validConnections.push({
            local: flyoutConn,
            neighbour: workspaceConn,
            distance: 0, // Distance doesn't matter for flyout placement
          });
        }
      }
    }

    // Limit for performance
    return validConnections.slice(0, 50);
  }
}