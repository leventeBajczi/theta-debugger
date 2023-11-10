import React, { Component } from 'react';
import { io } from 'socket.io-client';
import Mutex from "await-mutex";
import clone from 'clone';
import Tree from 'react-d3-tree';
import Switch from './components/Switch';
import PureSvgNodeElement from './components/PureSvgNodeElement';
import './App.css';

const arg = {};


const customNodeFnMapping = {
  svg: {
    description: 'Default - Pure SVG node & label (IE11 compatible)',
    fn: (rd3tProps, appState) => (
      <PureSvgNodeElement
        nodeDatum={rd3tProps.nodeDatum}
        toggleNode={rd3tProps.toggleNode}
        orientation={appState.orientation}
      />
    ),
  }
};

const countNodes = (count = 0, n) => {
  // Count the current node
  count += 1;

  // Base case: reached a leaf node.
  if (!n.children) {
    return count;
  }

  // Keep traversing children while updating `count` until we reach the base case.
  return n.children.reduce((sum, child) => countNodes(sum, child), count);
};

class App extends Component {
  constructor() {
    super();

    this.state = {
      data: arg,
      totalNodeCount: countNodes(0, arg),
      orientation: 'vertical',
      dimensions: undefined,
      centeringTransitionDuration: 800,
      collapsible: false,
      shouldCollapseNeighborNodes: false,
      initialDepth: undefined,
      depthFactor: 100,
      zoomable: true,
      draggable: true,
      scaleExtent: { min: 0.01, max: 1 },
      separation: { siblings: 1, nonSiblings: 1.25 },
      nodeSize: { x: 200, y: 200 },
      enableLegacyTransitions: false,
      transitionDuration: 500,
      renderCustomNodeElement: customNodeFnMapping['svg'].fn,
      styles: {},
      wsURL: "http://localhost:8080",
      socket: undefined,
      waitForContinue: false,
      tooltipAction: "",
      tooltipState: "",
      closeToolTip: true,
      mutex: new Mutex()
    };

    this.setTreeData = this.setTreeData.bind(this);
    this.setLargeTree = this.setLargeTree.bind(this);
    this.setOrientation = this.setOrientation.bind(this);
    this.setPathFunc = this.setPathFunc.bind(this);
    this.handleChange = this.handleChange.bind(this);
    this.handleFloatChange = this.handleFloatChange.bind(this);
    this.toggleCollapsible = this.toggleCollapsible.bind(this);
    this.toggleZoomable = this.toggleZoomable.bind(this);
    this.toggleDraggable = this.toggleDraggable.bind(this);
    this.toggleCenterNodes = this.toggleCenterNodes.bind(this);
    this.setScaleExtent = this.setScaleExtent.bind(this);
    this.setSeparation = this.setSeparation.bind(this);
    this.setNodeSize = this.setNodeSize.bind(this);
  }

  setTreeData(data) {
    this.setState({
      data,
      totalNodeCount: countNodes(0, Array.isArray(data) ? data[0] : data),
    });
  }

  setLargeTree(data) {
    this.setState({
      data,
      transitionDuration: 0,
    });
  }

  setOrientation(orientation) {
    this.setState({ orientation });
  }

  setPathFunc(pathFunc) {
    this.setState({ pathFunc });
  }

  handleChange(evt) {
    const target = evt.target;
    const parsedIntValue = parseInt(target.value, 10);
    if (target.value === '') {
      this.setState({
        [target.name]: undefined,
      });
    } else if (!isNaN(parsedIntValue)) {
      this.setState({
        [target.name]: parsedIntValue,
      });
    }
  }

  handleFloatChange(evt) {
    const target = evt.target;
    const parsedFloatValue = parseFloat(target.value);
    if (target.value === '') {
      this.setState({
        [target.name]: undefined,
      });
    } else if (!isNaN(parsedFloatValue)) {
      this.setState({
        [target.name]: parsedFloatValue,
      });
    }
  }

  handleCustomNodeFnChange = evt => {
    const customNodeKey = evt.target.value;

    this.setState({ renderCustomNodeElement: customNodeFnMapping[customNodeKey].fn });
  };

  toggleCollapsible() {
    this.setState(prevState => ({ collapsible: !prevState.collapsible }));
  }

  toggleCollapseNeighborNodes = () => {
    this.setState(prevState => ({
      shouldCollapseNeighborNodes: !prevState.shouldCollapseNeighborNodes,
    }));
  };

  toggleZoomable() {
    this.setState(prevState => ({ zoomable: !prevState.zoomable }));
  }

  toggleDraggable() {
    this.setState(prevState => ({ draggable: !prevState.draggable }));
  }

  toggleCenterNodes() {
    if (this.state.dimensions !== undefined) {
      this.setState({
        dimensions: undefined,
      });
    } else {
      if (this.treeContainer) {
        const { width, height } = this.treeContainer.getBoundingClientRect();
        this.setState({
          dimensions: {
            width,
            height,
          },
        });
      }
    }
  }

  setScaleExtent(scaleExtent) {
    this.setState({ scaleExtent });
  }

  setSeparation(separation) {
    if (!isNaN(separation.siblings) && !isNaN(separation.nonSiblings)) {
      this.setState({ separation });
    }
  }

  setNodeSize(nodeSize) {
    if (!isNaN(nodeSize.x) && !isNaN(nodeSize.y)) {
      this.setState({ nodeSize });
    }
  }

  findNodeWithId = (id, parent) => {
    if(parent.id === id) return parent;
    const children = parent.children ? parent.children : [];
    for(var i = 0; i < children.length; i++) {
      const ret = this.findNodeWithId(id, children[i]);
      if(ret) return ret;
    }
    return undefined;
  }

  addChildNode = (parentId, child, callback) => {
    const data = clone(this.state.data);

    const parent = this.findNodeWithId(parentId, data);

    parent.children = parent.children ? parent.children : [];
    const target = parent.children;
    target.push(child);
    this.setState({
      data: data,
      totalNodeCount: countNodes(0, data)
    }, callback);
  };

  removeChildNode = (parentId, childId, callback) => {
    const data = clone(this.state.data);
    const parent = this.findNodeWithId(parentId, data);
    const child = this.findNodeWithId(childId, data);

    const target = parent.children ? parent.children : [];

    const arrayRemove = (arr, value) => {
      return arr.filter(function (geeks) {
          return geeks !== value;
      });
    };

    parent.children = arrayRemove(target, child);
    this.setState({
      data: data,
      totalNodeCount: countNodes(0, data)
    }, callback);
  };

  handleMessage = async (event) => {
    let unlock = await this.state.mutex.lock();
    console.log("Message from server: ", event);
    const message = JSON.parse(event);
    if(message.method === "add") {
      const parentId = message.parent;
      const child = message.child;
      this.addChildNode(parentId, child, unlock);
    }
    else if(message.method === "delete") {
      const parentId = message.parent;
      const childId = message.child;
      this.removeChildNode(parentId, childId, unlock);
    } 
    else if(message.method === "create") {
      this.setState({
        data: message.node,
        totalNodeCount: countNodes(0, message.node)
      }, unlock);
    } 
    else if (message.method === "wait") {
      this.setState({waitForContinue: true}, unlock);
    } else {
      unlock();
    }
  }

  componentDidMount() {
    const dimensions = this.treeContainer.getBoundingClientRect();
    this.setState({
      translateX: dimensions.width / 2,
      translateY: 100,
    });

  }

  render() {
    return (
      <div className="App">
        <div className="demo-container">
          <div className="column-left">
            <div className="controls-container">
              <div className="prop-container">
                <h2 className="title">Theta ARG Debugger</h2>
              </div>

              <div className="prop-container">
                <h4 className="prop">Setup</h4>
                <label className="prop" htmlFor="wsURL">
                  WS URL
                </label>
                <input
                  className="form-control"
                  name="wsURL"
                  defaultValue={this.state.wsURL}
                  onChange={(evt) => this.setState({wsURL: evt.target.value})}
                />
                <button
                  type="button"
                  className="btn btn-controls btn-block"
                  onClick={() => {
                    const socket = io(this.state.wsURL, {transports: ['websocket']});
                    socket.on("connect", () => {
                      console.log("Connection established ");
                      this.setState({socket: socket})
                    });
                    socket.on("error", (error) => {
                      console.log(error);
                    });
                    socket.io.on("disconnect", () => {
                      console.log("Connection closed ");
                      this.setState({socket: undefined})
                    });
                    socket.on("message", event => this.handleMessage(event));
                  }}
                >
                  {'Connect'}
                </button>
                <button
                  type="button"
                  disabled={this.state.socket === undefined || !this.state.waitForContinue}
                  className="btn btn-controls btn-block"
                  onClick={() => {
                    this.setState({waitForContinue: false});
                    this.state.socket.emit('continue', 'continue');
                  }}
                >
                  {'Continue'}
                </button>
              </div>

              <div className="prop-container">
                <h4 className="prop">Orientation</h4>
                <button
                  type="button"
                  className="btn btn-controls btn-block"
                  onClick={() => this.setOrientation('horizontal')}
                >
                  {'Horizontal'}
                </button>
                <button
                  type="button"
                  className="btn btn-controls btn-block"
                  onClick={() => this.setOrientation('vertical')}
                >
                  {'Vertical'}
                </button>
              </div>

              <div className="prop-container">
                <h4 className="prop">Path Function</h4>
                <button
                  type="button"
                  className="btn btn-controls btn-block"
                  onClick={() => this.setPathFunc('diagonal')}
                >
                  {'Diagonal'}
                </button>
                <button
                  type="button"
                  className="btn btn-controls btn-block"
                  onClick={() => this.setPathFunc('elbow')}
                >
                  {'Elbow'}
                </button>
                <button
                  type="button"
                  className="btn btn-controls btn-block"
                  onClick={() => this.setPathFunc('straight')}
                >
                  {'Straight'}
                </button>
                <button
                  type="button"
                  className="btn btn-controls btn-block"
                  onClick={() => this.setPathFunc('step')}
                >
                  {'Step'}
                </button>
              </div>

              <div className="prop-container">
                <h4 className="prop">Collapsible</h4>
                <Switch
                  name="collapsibleBtn"
                  checked={this.state.collapsible}
                  onChange={this.toggleCollapsible}
                />
              </div>

              <div className="prop-container">
                <h4 className="prop">Zoomable</h4>
                <Switch
                  name="zoomableBtn"
                  checked={this.state.zoomable}
                  onChange={this.toggleZoomable}
                />
              </div>

              <div className="prop-container">
                <h4 className="prop">Draggable</h4>
                <Switch
                  name="draggableBtn"
                  checked={this.state.draggable}
                  onChange={this.toggleDraggable}
                />
              </div>

              <div className="prop-container">
                <h4 className="prop">
                  Center Nodes on Click (via <code>dimensions</code> prop)
                </h4>
                <Switch
                  name="centerNodesBtn"
                  checked={this.state.dimensions !== undefined}
                  onChange={this.toggleCenterNodes}
                />
              </div>

              <div className="prop-container">
                <h4 className="prop">Collapse neighbor nodes</h4>
                <Switch
                  name="collapseNeighborsBtn"
                  checked={this.state.shouldCollapseNeighborNodes}
                  onChange={this.toggleCollapseNeighborNodes}
                />
              </div>

              <div className="prop-container">
                <label className="prop" htmlFor="depthFactor">
                  Depth Factor (level separation, px)
                </label>
                <input
                  className="form-control"
                  name="depthFactor"
                  type="number"
                  defaultValue={this.state.depthFactor}
                  onChange={this.handleChange}
                />
              </div>

              <div className="prop-container">
                <label className="prop" htmlFor="zoom">
                  Zoom
                </label>
                <input
                  className="form-control"
                  name="zoom"
                  type="number"
                  defaultValue={this.state.zoom}
                  onChange={this.handleFloatChange}
                />
              </div>

              <div className="prop-container">
                <span className="prop prop-large">Scale Extent</span>
                <label className="sub-prop" htmlFor="scaleExtentMin">
                  Min
                </label>
                <input
                  className="form-control"
                  name="scaleExtentMin"
                  type="number"
                  defaultValue={this.state.scaleExtent.min}
                  onChange={evt =>
                    this.setScaleExtent({
                      min: parseFloat(evt.target.value),
                      max: this.state.scaleExtent.max,
                    })
                  }
                />
                <label className="sub-prop" htmlFor="scaleExtentMax">
                  Max
                </label>
                <input
                  className="form-control"
                  name="scaleExtentMax"
                  type="number"
                  defaultValue={this.state.scaleExtent.max}
                  onChange={evt =>
                    this.setScaleExtent({
                      min: this.state.scaleExtent.min,
                      max: parseFloat(evt.target.value),
                    })
                  }
                />
              </div>

              <div className="prop-container">
                <span className="prop prop-large">Node separation</span>
                <label className="sub-prop" htmlFor="separationSiblings">
                  Siblings
                </label>
                <input
                  className="form-control"
                  name="separationSiblings"
                  type="number"
                  defaultValue={this.state.separation.siblings}
                  onChange={evt =>
                    this.setSeparation({
                      siblings: parseFloat(evt.target.value),
                      nonSiblings: this.state.separation.nonSiblings,
                    })
                  }
                />
                <label className="sub-prop" htmlFor="separationNonSiblings">
                  Non-Siblings
                </label>
                <input
                  className="form-control"
                  name="separationNonSiblings"
                  type="number"
                  defaultValue={this.state.separation.nonSiblings}
                  onChange={evt =>
                    this.setSeparation({
                      siblings: this.state.separation.siblings,
                      nonSiblings: parseFloat(evt.target.value),
                    })
                  }
                />
              </div>

              <div className="prop-container">
                <span className="prop prop-large">Node size</span>
                <label className="sub-prop" htmlFor="nodeSizeX">
                  X
                </label>
                <input
                  className="form-control"
                  name="nodeSizeX"
                  type="number"
                  defaultValue={this.state.nodeSize.x}
                  onChange={evt =>
                    this.setNodeSize({ x: parseFloat(evt.target.value), y: this.state.nodeSize.y })
                  }
                />
                <label className="sub-prop" htmlFor="nodeSizeY">
                  Y
                </label>
                <input
                  className="form-control"
                  name="nodeSizeY"
                  type="number"
                  defaultValue={this.state.nodeSize.y}
                  onChange={evt =>
                    this.setNodeSize({ x: this.state.nodeSize.x, y: parseFloat(evt.target.value) })
                  }
                />
              </div>
            </div>
          </div>``

          <div className="column-right">
            <div className="tree-stats-container">
              Total nodes in tree: {this.state.totalNodeCount}
            </div>
            <div ref={tc => (this.treeContainer = tc)} className="tree-container">
              <Tree
                hasInteractiveNodes
                data={this.state.data}
                rootNodeClassName="demo-node"
                branchNodeClassName="demo-node"
                leafNodeClassName="demo-node"
                orientation={this.state.orientation}
                dimensions={this.state.dimensions}
                centeringTransitionDuration={this.state.centeringTransitionDuration}
                translate={{ x: this.state.translateX, y: this.state.translateY }}
                pathFunc={this.state.pathFunc}
                collapsible={this.state.collapsible}
                initialDepth={this.state.initialDepth}
                zoomable={this.state.zoomable}
                draggable={this.state.draggable}
                zoom={this.state.zoom}
                scaleExtent={this.state.scaleExtent}
                nodeSize={this.state.nodeSize}
                separation={this.state.separation}
                enableLegacyTransitions={this.state.enableLegacyTransitions}
                transitionDuration={this.state.transitionDuration}
                depthFactor={this.state.depthFactor}
                styles={this.state.styles}
                shouldCollapseNeighborNodes={this.state.shouldCollapseNeighborNodes}
                onNodeMouseOver={(node, evt) => {
                  this.setState({
                    tooltipAction: node && node.data && node.data.tooltip && node.data.tooltip.action ? node.data.tooltip.action : "",
                    tooltipState: node && node.data && node.data.tooltip && node.data.tooltip.state ? node.data.tooltip.state : "",
                    closeToolTip: true
                  })
                }}
                onNodeMouseOut={(...args) => {
                  if(this.state.closeToolTip) this.setState({tooltipAction: "", tooltipState: ""})
                }}
                onNodeClick={() => {
                  this.setState({closeToolTip: false})
                }}
              />
            </div>
            <div className="long-state-container">
              {this.state.tooltipAction ? "Action: " + this.state.tooltipAction : ""}
            </div>
            <div className="long-state-container">
              {this.state.tooltipState ? "State: " + this.state.tooltipState : ""}
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export default App;
