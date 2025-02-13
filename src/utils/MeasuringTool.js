
import * as THREE from "three";
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

import {Measure, MeasureTypes} from "./Measure.js";
import {Utils} from "../utils.js";
import {CameraMode} from "../defines.js";
import { EventDispatcher } from "../EventDispatcher.js";

function updateAzimuth(viewer, measure){

	const azimuth = measure.azimuth;

	const isOkay = measure.points.length === 2;

	azimuth.node.visible = isOkay && measure.showAzimuth;

	if(!azimuth.node.visible){
		return;
	}

	const camera = viewer.scene.getActiveCamera();
	const renderAreaSize = viewer.renderer.getSize(new THREE.Vector2());
	const width = renderAreaSize.width;
	const height = renderAreaSize.height;
	
	const [p0, p1] = measure.points;
	const r = p0.position.distanceTo(p1.position);
	const northVec = Utils.getNorthVec(p0.position, r, viewer.getProjection());
	const northPos = p0.position.clone().add(northVec);

	azimuth.center.position.copy(p0.position);
	azimuth.center.scale.set(2, 2, 2);
	
	azimuth.center.visible = false;
	// azimuth.target.visible = false;


	{ // north
		azimuth.north.position.copy(northPos);
		azimuth.north.scale.set(2, 2, 2);

		let distance = azimuth.north.position.distanceTo(camera.position);
		let pr = Utils.projectedRadius(1, camera, distance, width, height);

		let scale = (5 / pr);
		azimuth.north.scale.set(scale, scale, scale);
	}

	{ // target
		azimuth.target.position.copy(p1.position);
		azimuth.target.position.z = azimuth.north.position.z;

		let distance = azimuth.target.position.distanceTo(camera.position);
		let pr = Utils.projectedRadius(1, camera, distance, width, height);

		let scale = (5 / pr);
		azimuth.target.scale.set(scale, scale, scale);
	}


	azimuth.circle.position.copy(p0.position);
	azimuth.circle.scale.set(r, r, r);
	azimuth.circle.material.resolution.set(width, height);

	// to target
	azimuth.centerToTarget.geometry.setPositions([
		0, 0, 0,
		...p1.position.clone().sub(p0.position).toArray(),
	]);
	azimuth.centerToTarget.position.copy(p0.position);
	azimuth.centerToTarget.geometry.verticesNeedUpdate = true;
	azimuth.centerToTarget.geometry.computeBoundingSphere();
	azimuth.centerToTarget.computeLineDistances();
	azimuth.centerToTarget.material.resolution.set(width, height);

	// to target ground
	azimuth.centerToTargetground.geometry.setPositions([
		0, 0, 0,
		p1.position.x - p0.position.x,
		p1.position.y - p0.position.y,
		0,
	]);
	azimuth.centerToTargetground.position.copy(p0.position);
	azimuth.centerToTargetground.geometry.verticesNeedUpdate = true;
	azimuth.centerToTargetground.geometry.computeBoundingSphere();
	azimuth.centerToTargetground.computeLineDistances();
	azimuth.centerToTargetground.material.resolution.set(width, height);

	// to north
	azimuth.centerToNorth.geometry.setPositions([
		0, 0, 0,
		northPos.x - p0.position.x,
		northPos.y - p0.position.y,
		0,
	]);
	azimuth.centerToNorth.position.copy(p0.position);
	azimuth.centerToNorth.geometry.verticesNeedUpdate = true;
	azimuth.centerToNorth.geometry.computeBoundingSphere();
	azimuth.centerToNorth.computeLineDistances();
	azimuth.centerToNorth.material.resolution.set(width, height);

	// label
	const radians = Utils.computeAzimuth(p0.position, p1.position, viewer.getProjection());
	let degrees = THREE.Math.radToDeg(radians);
	if(degrees < 0){
		degrees = 360 + degrees;
	}
	const txtDegrees = `${degrees.toFixed(2)}°`;
	const labelDir = northPos.clone().add(p1.position).multiplyScalar(0.5).sub(p0.position);
	if(labelDir.length() > 0){
		labelDir.z = 0;
		labelDir.normalize();
		const labelVec = labelDir.clone().multiplyScalar(r);
		const labelPos = p0.position.clone().add(labelVec);
		azimuth.label.position.copy(labelPos);
	}
	azimuth.label.setText(txtDegrees);
	let distance = azimuth.label.position.distanceTo(camera.position);
	let pr = Utils.projectedRadius(1, camera, distance, width, height);
	let scale = (70 / pr);
	azimuth.label.scale.set(scale, scale, scale);
}

export class MeasuringTool extends EventDispatcher{
	constructor (viewer) {
		super();

		this.viewer = viewer;
		this.renderer = viewer.renderer;
		this.isLongPress = false;

		this.addEventListener('start_inserting_measurement', e => {
			this.viewer.dispatchEvent({
				type: 'cancel_insertions'
			});
		});

		this.showLabels = true;
		this.scene = new THREE.Scene();
		this.scene.name = 'scene_measurement';
		this.light = new THREE.PointLight(0xffffff, 1.0);
		this.scene.add(this.light);
		this.sphereIntersected = false;
		this.measure = null;
		this.cancel = {
			removeLastMarker: false,
			isMarker: false,
			endMeasurement: false,
			callback: null
		  };

		this.viewer.inputHandler.registerInteractiveScene(this.scene);

		this.labelRenderer = new CSS2DRenderer();
		this.labelRenderer.setSize(0, 0);
		this.labelRenderer.domElement.style.position = 'absolute';
		this.labelRenderer.domElement.style.top = '0px';
		this.labelRenderer.domElement.style.pointerEvents = 'none';
		this.labelRenderer.domElement.style.display = 'block';

		viewer.renderArea.appendChild(this.labelRenderer.domElement);

		this.onRemove = (e) => { this.scene.remove(e.measurement);};
		this.onAdd = e => {this.scene.add(e.measurement)};

		for(let measurement of viewer.scene.measurements){
			this.onAdd({measurement: measurement});
		}

		viewer.addEventListener("update", this.update.bind(this));
		viewer.addEventListener("render.pass.perspective_overlay", this.render.bind(this));
		viewer.addEventListener("scene_changed", this.onSceneChange.bind(this));

		this.viewer.inputHandler.addEventListener('sphere_intersected', this.onSphereIntersected.bind(this));
		this.viewer.inputHandler.addEventListener('sphere_not_intersected', this.onSphereNotIntersected.bind(this));
		// this.viewer.inputHandler.addEventListener('measurement_selected', () => console.log('hi'))

		// this.viewer.inputHandler.addEventListener('keydown', this.handleKeyDown.bind(this));

		viewer.scene.addEventListener('measurement_added', this.onAdd);
		viewer.scene.addEventListener('measurement_removed', this.onRemove);
	}

	onSphereIntersected() {
		this.sphereIntersected = true;
	}
	onSphereNotIntersected() {
		this.sphereIntersected = false;
	}

	handleKeyDown(event){
		console.log(event);
	}

	onSceneChange(e){
		if(e.oldScene){
			e.oldScene.removeEventListener('measurement_added', this.onAdd);
			e.oldScene.removeEventListener('measurement_removed', this.onRemove);
		}

		e.scene.addEventListener('measurement_added', this.onAdd);
		e.scene.addEventListener('measurement_removed', this.onRemove);
	}

	revertSphereAndLines() {
		const measurements = this.viewer.scene.measurements;

		for (const currentMeasurement of measurements) {
		  currentMeasurement.removeAddMarker();
		}
		for (const measure of measurements) {
		  measure.showDistances = false;
		  for (const sphere of measure.spheres) {
			sphere.visible = false;
		  }
		  if (measure.baseLabel && measure.heightLabel) {
			measure.showHeightLabel = false;
			measure.baseLabel.visible = false;
			measure.heightLabel.visible = false;
		  }
		  if (measure.areaLabel) {
			measure.showAreaLabel = false
		  }
		}
	  }

	async startInsertion (args = {}) {
		let domElement = this.viewer.renderer.domElement;
		let camera = this.viewer.scene.getActiveCamera();

		const pick = (defaul, alternative) => {
			if(defaul != null){
				return defaul;
			}else{
				return alternative;
			}
		};

		let measure = new Measure(pick(args.contentType, 'three_length'));
		this.measure = measure;

		const textures = await measure.loadAllTexture();
		measure.setTextures = textures;

			this.dispatchEvent({
				type: 'start_inserting_measurement',
				measure: measure
			});
			this.viewer.renderer.domElement.style.cursor = 'crosshair';
			
	
			measure.showDistances = (args.showDistances === null) ? true : args.showDistances;
			measure.showTotalDistances = pick(args.showTotalDistances, false);

			measure.showArea = pick(args.showArea, false);
			measure.showAngles = pick(args.showAngles, false);
			measure.showCoordinates = pick(args.showCoordinates, false);
			measure.showHeight = pick(args.showHeight, false);
			measure.showHeightLabel = pick(args.showHeightLabel, false);
			measure.showCircle = pick(args.showCircle, false);
			measure.showAzimuth = pick(args.showAzimuth, false);
			measure.showEdges = pick(args.showEdges, true);
			measure.closed = pick(args.closed, false);
			measure.maxMarkers = pick(args.maxMarkers, Infinity);
	
			measure.name = args.name || 'Measurement';
	
			this.scene.add(measure);
	
			// let cancel = {
			// 	removeLastMarker: measure.maxMarkers > 3,
			// 	callback: null,
			// 	endMeasurement: false,
			// };
			this.cancel.removeLastMarker = measure.maxMarkers > 3
	
			if (measure.maxMarkers > 1) {
				this.viewer.addEventListener('cancel_insertions', this.callback.bind(this));
				domElement.addEventListener('mouseup', this.insertionCallback.bind(this), false);
			}
	
			measure.addMarker(new THREE.Vector3(0, 0, 0));
			this.viewer.inputHandler.startDragging(
				measure.spheres[measure.spheres.length - 1]);
	
			this.viewer.scene.addMeasurement(measure);
			return measure;

	}

	insertionCallback(e) {
		if(!this.measure) {
			return
		}

		

		if (e.button === THREE.MOUSE.LEFT || e.button === THREE.MOUSE.RIGHT) {
			if (this.measure.points.length > 1 && this.isLongPress) {
				// do nothing
			} else {
				this.measure.addMarker(this.measure.points[this.measure.points.length - 1].position.clone());
			}

			if (this.measure.points.length >= this.measure.maxMarkers) {
				this.callback();
			}

			this.measure.spheres.map(v => {
				v.visible = true; 
				v.material = this.measure.createSpriteMaterial();
				v.name = '';
				return v;
			  });

			  this.viewer.inputHandler.startDragging(
				this.measure.spheres[this.measure.spheres.length - 1]);

			if (this.measure.spheres.length > 2) {
				const dragSphere = this.measure.spheres[this.measure.spheres.length - 2];
				this.measure.spheres[this.measure.spheres.length - 2].visible = true;
				// const lastSphere = measure.spheres[measure.spheres.length - 1];

				dragSphere.material.map = this.measure._textures.tickNodeTexture;
				dragSphere.name = 'right_tick';
				dragSphere.material.needsUpdate = true;
				// dragSphere.visible = true;

				// if lastsphere and dragshere are on the same position call cancel.callback()
				if (this.sphereIntersected) {
					this.cancel.endMeasurement = true;
					this.cancel.removeLastMarker = false;
					this.callback();
				}
				
			}

			
		// } else if (e.button === THREE.MOUSE.RIGHT) {
		// 	cancel.callback();
		}
		this.isLongPress = false;
	};

	callback() {
		if(!this.measure) {
			return
		}

		if (this.cancel.removeLastMarker) {
			this.measure.removeMarker(this.measure.points.length - 1);
		}

		if (this.cancel.endMeasurement) {
			this.measure.removeMarker(this.measure.points.length - 1);
			this.measure.endMeasurement(this.measure.points.length - 1);
			this.measure.spheres[this.measure.spheres.length - 1].material = this.measure.createSpriteMaterial();
			this.dispatchEvent({
				type: 'end_measurement_insertion',
				measurement: this.measure
			})
			this.viewer.renderer.domElement.style.cursor = 'auto';
			// measure.measurementLabel.update(THREE.Math.generateUUID());
			// measure.userData.contentId = THREE.Math.generateUUID();
			
			this.measure.updateSphereVisibility(this.viewer.scene.getActiveCamera(), false);

			// if (measure.name !== MeasureTypes.P2P_TRIANGLE) {
			// 	const allPositions = measure.createPositions(measure.spheres);
			// 	allPositions.map((pos, index) => {
			// 		measure.updateAddMarker(pos.points, pos.index + index + 1, camera);
			// 	})
			// }
			// measure.revertSphereAndLines([measure]);
		}

		this.dispose();

	};
	
	update(){
		let camera = this.viewer.scene.getActiveCamera();
		let domElement = this.renderer.domElement;
		let measurements = this.viewer.scene.measurements;
		

		const renderAreaSize = this.renderer.getSize(new THREE.Vector2());
		let clientWidth = renderAreaSize.width;
		let clientHeight = renderAreaSize.height;

		this.labelRenderer.setSize(clientWidth, clientHeight);

		this.light.position.copy(camera.position);

		// make size independant of distance
		for (let measure of measurements) {
			measure.lengthUnit = this.viewer.lengthUnit;
			measure.lengthUnitDisplay = this.viewer.lengthUnitDisplay;
			measure.update();

			updateAzimuth(this.viewer, measure);

			// spheres
			for(let sphere of measure.spheres){
				let distance = camera.position.distanceTo(sphere.getWorldPosition(new THREE.Vector3()));
				let pr = Utils.projectedRadius(1, camera, distance, clientWidth, clientHeight);
				let scale = (15 / pr);

				if (sphere.name === 'add') {
					sphere.scale.setScalar(scale * 0.9);
				  } else if (sphere.name === 'right_tick') {
					sphere.scale.setScalar(scale * 1.5);
				  } else {
					sphere.scale.setScalar(scale);
				  }
				// sphere.scale.set(scale, scale, scale);
			}

			// labels
			let labels = measure.edgeLabels.concat(measure.angleLabels).concat(measure.baseLabel).concat(measure.totalDistanceLabel);
			for(let label of labels){
				let distance = camera.position.distanceTo(label.getWorldPosition(new THREE.Vector3()));
				let pr = Utils.projectedRadius(1, camera, distance, clientWidth, clientHeight);
				let scale = (70 / pr);

				if(Potree.debug.scale){
					scale = (Potree.debug.scale / pr);
				}

				label.scale.set(scale, scale, scale);
			}

			// coordinate labels
			for (let j = 0; j < measure.coordinateLabels.length; j++) {
				let label = measure.coordinateLabels[j];
				let sphere = measure.spheres[j];

				let distance = camera.position.distanceTo(sphere.getWorldPosition(new THREE.Vector3()));

				let screenPos = sphere.getWorldPosition(new THREE.Vector3()).clone().project(camera);
				screenPos.x = Math.round((screenPos.x + 1) * clientWidth / 2);
				screenPos.y = Math.round((-screenPos.y + 1) * clientHeight / 2);
				screenPos.z = 0;
				screenPos.y -= 30;

				let labelPos = new THREE.Vector3( 
					(screenPos.x / clientWidth) * 2 - 1, 
					-(screenPos.y / clientHeight) * 2 + 1, 
					0.5 );
				labelPos.unproject(camera);
				if(this.viewer.scene.cameraMode == CameraMode.PERSPECTIVE) {
					let direction = labelPos.sub(camera.position).normalize();
					labelPos = new THREE.Vector3().addVectors(
						camera.position, direction.multiplyScalar(distance));

				}
				label.position.copy(labelPos);
				let pr = Utils.projectedRadius(1, camera, distance, clientWidth, clientHeight);
				let scale = (70 / pr);
				label.scale.set(scale, scale, scale);
			}

			// height label
			if (measure.showHeight) {
				let label = measure.heightLabel;

				{
					let distance = label.position.distanceTo(camera.position);
					let pr = Utils.projectedRadius(1, camera, distance, clientWidth, clientHeight);
					let scale = (70 / pr);
					label.scale.set(scale, scale, scale);
				}

				{ // height edge
					let edge = measure.heightEdge;

					let sorted = measure.points.slice().sort((a, b) => a.position.z - b.position.z);
					let lowPoint = sorted[0].position.clone();
					let highPoint = sorted[sorted.length - 1].position.clone();
					let min = lowPoint.z;
					let max = highPoint.z;

					let start = new THREE.Vector3(highPoint.x, highPoint.y, min);
					let end = new THREE.Vector3(highPoint.x, highPoint.y, max);

					let lowScreen = lowPoint.clone().project(camera);
					let startScreen = start.clone().project(camera);
					let endScreen = end.clone().project(camera);

					let toPixelCoordinates = v => {
						let r = v.clone().addScalar(1).divideScalar(2);
						r.x = r.x * clientWidth;
						r.y = r.y * clientHeight;
						r.z = 0;

						return r;
					};

					let lowEL = toPixelCoordinates(lowScreen);
					let startEL = toPixelCoordinates(startScreen);
					let endEL = toPixelCoordinates(endScreen);

					let lToS = lowEL.distanceTo(startEL);
					let sToE = startEL.distanceTo(endEL);

					edge.geometry.lineDistances = [0, lToS, lToS, lToS + sToE];
					edge.geometry.lineDistancesNeedUpdate = true;

					edge.material.dashSize = 10;
					edge.material.gapSize = 10;
				}
			}

			{ // area label
				let label = measure.areaLabel;
				let distance = label.position.distanceTo(camera.position);
				let pr = Utils.projectedRadius(1, camera, distance, clientWidth, clientHeight);

				let scale = (70 / pr);
				label.scale.set(scale, scale, scale);
			}

			{ // radius label
				let label = measure.circleRadiusLabel;
				let distance = label.position.distanceTo(camera.position);
				let pr = Utils.projectedRadius(1, camera, distance, clientWidth, clientHeight);

				let scale = (70 / pr);
				label.scale.set(scale, scale, scale);
			}

			{ // edges
				const materials = [
					measure.circleRadiusLine.material,
					...measure.edges.map( (e) => e.material),
					measure.heightEdge.material,
					measure.circleLine.material,
				];

				for(const material of materials){
					material.resolution.set(clientWidth, clientHeight);
				}
			}

			if(!this.showLabels){

				const labels = [
					...measure.sphereLabels, 
					...measure.edgeLabels, 
					...measure.angleLabels, 
					...measure.coordinateLabels,
					measure.heightLabel,
					measure.areaLabel,
					measure.circleRadiusLabel,
				];

				for(const label of labels){
					label.visible = false;
				}
			}
		}
	}

	dispose() {
		this.viewer.renderer.domElement.style.cursor = 'auto';

		this.viewer.inputHandler.removeEventListener('sphere_intersected', this.onSphereIntersected.bind(this));
		this.viewer.inputHandler.removeEventListener('sphere_not_intersected', this.onSphereNotIntersected.bind(this))
		this.viewer.renderer.domElement.removeEventListener('mouseup', this.insertionCallback.bind(this), false);
		this.viewer.removeEventListener('cancel_insertions', this.callback.bind(this));

		if (this.measure) {
			this.viewer.scene.removeMeasurement(this.measure);
		  }
		 // resetting values
		 this.measure = null;
		 this.cancel = {
		   removeLastMarker: false,
		   isMarker: false,
		   endMeasurement: false,
		   callback: null
		 };
	}

	render(){
		this.viewer.renderer.render(this.scene, this.viewer.scene.getActiveCamera());
		this.labelRenderer.render(this.scene, this.viewer.scene.getActiveCamera());
	}
};
