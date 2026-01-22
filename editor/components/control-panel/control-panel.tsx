'use client';

import { fadeIn } from '@/utils/animations';
import { motion } from 'framer-motion';
import { useRef, useState, useEffect } from 'react';
import type { RoomState } from '@/app/actions/actions';
import LayoutSelector from '@/components/layout-selector';
import Accordion, { type AccordionHandle } from '@/components/ui/accordion';
import { useControlPanelState } from './hooks/use-control-panel-state';
import { useWhipConnections } from './hooks/use-whip-connections';
import { useControlPanelEvents } from './hooks/use-control-panel-events';
import { FxAccordion } from './components/FxAccordion';
import { AddVideoSection } from './components/AddVideoSection';
import { StreamsSection } from './components/StreamsSection';
import { QuickActionsSection } from './components/QuickActionsSection';
import { ConfigurationSection, type PendingWhipInput } from './components/ConfigurationSection';
import { PendingWhipInputs } from './components/PendingWhipInputs';
import { loadPendingWhipInputs } from '@/lib/room-config';

export type ControlPanelProps = {
    roomId: string;
    roomState: RoomState;
    refreshState: () => Promise<void>;
};

export type { InputWrapper } from './hooks/use-control-panel-state';

export default function ControlPanel({
    refreshState,
    roomId,
    roomState,
}: ControlPanelProps) {
    const addVideoAccordionRef = useRef<AccordionHandle | null>(null);
      const [pendingWhipInputs, setPendingWhipInputs] = useState<PendingWhipInput[]>([]);

      useEffect(() => {
        const stored = loadPendingWhipInputs(roomId);
        if (stored.length > 0) {
          setPendingWhipInputs(stored);
        }
      }, [roomId]);

    const {
        userName,
        setUserName,
        inputs,
        inputsRef,
        showStreamsSpinner,
        addInputActiveTab,
        setAddInputActiveTab,
        streamActiveTab,
        setStreamActiveTab,
        inputsActiveTab,
        setInputsActiveTab,
        inputWrappers,
        setInputWrappers,
        listVersion,
        setListVersion,
        handleRefreshState,
        availableShaders,
        updateOrder,
        changeLayout,
        openFxInputId,
        setOpenFxInputId,
        nextIfComposing,
    } = useControlPanelState(roomId, roomState, refreshState);

    const whipConnections = useWhipConnections(
        roomId,
        userName,
        inputs,
        inputsRef,
        handleRefreshState,
    );
    const {
        cameraPcRef,
        cameraStreamRef,
        activeCameraInputId,
        setActiveCameraInputId,
        isCameraActive,
        setIsCameraActive,
        screensharePcRef,
        screenshareStreamRef,
        activeScreenshareInputId,
        setActiveScreenshareInputId,
        isScreenshareActive,
        setIsScreenshareActive,
    } = whipConnections;

    useControlPanelEvents({
        inputsRef,
        inputWrappers,
        setInputWrappers,
        setListVersion,
        updateOrder,
        nextIfComposing,
        setAddInputActiveTab,
        setStreamActiveTab,
        addVideoAccordionRef,
        roomId,
        handleRefreshState,
        cameraPcRef,
        cameraStreamRef,
        screensharePcRef,
        screenshareStreamRef,
        activeCameraInputId,
        activeScreenshareInputId,
        setActiveCameraInputId,
        setIsCameraActive,
        setActiveScreenshareInputId,
        setIsScreenshareActive,
        setOpenFxInputId,
    });

    const handleWhipDisconnectedOrRemoved = (id: string) => {
        if (activeCameraInputId === id) {
            setActiveCameraInputId(null);
            setIsCameraActive(false);
        }
        if (activeScreenshareInputId === id) {
            setActiveScreenshareInputId(null);
            setIsScreenshareActive(false);
        }
    };

    const handleToggleFx = (inputId: string) => {
        setOpenFxInputId((prev) => (prev === inputId ? null : inputId));
    };

    const fxInput =
        openFxInputId && inputs.find((i) => i.inputId === openFxInputId)
            ? inputs.find((i) => i.inputId === openFxInputId)!
            : null;

    return (
        <motion.div
            {...(fadeIn as any)}
            className='flex flex-col flex-1 min-h-0 gap-3 rounded-none bg-neutral-950 mt-6'>
            <video id='local-preview' muted playsInline autoPlay className='hidden' />

            {fxInput ? (
                <FxAccordion
                    fxInput={fxInput}
                    onClose={() => setOpenFxInputId(null)}
                    roomId={roomId}
                    refreshState={handleRefreshState}
                    availableShaders={availableShaders}
                    inputs={inputs}
                    cameraPcRef={cameraPcRef}
                    cameraStreamRef={cameraStreamRef}
                    activeCameraInputId={activeCameraInputId}
                    activeScreenshareInputId={activeScreenshareInputId}
                    onWhipDisconnectedOrRemoved={handleWhipDisconnectedOrRemoved}
                />
            ) : (
                <>
                    <AddVideoSection
                        inputs={inputs}
                        roomId={roomId}
                        refreshState={handleRefreshState}
                        addInputActiveTab={addInputActiveTab}
                        setAddInputActiveTab={setAddInputActiveTab}
                        streamActiveTab={streamActiveTab}
                        setStreamActiveTab={setStreamActiveTab}
                        inputsActiveTab={inputsActiveTab}
                        setInputsActiveTab={setInputsActiveTab}
                        userName={userName}
                        setUserName={setUserName}
                        cameraPcRef={cameraPcRef}
                        cameraStreamRef={cameraStreamRef}
                        screensharePcRef={screensharePcRef}
                        screenshareStreamRef={screenshareStreamRef}
                        setActiveCameraInputId={setActiveCameraInputId}
                        setIsCameraActive={setIsCameraActive}
                        setActiveScreenshareInputId={setActiveScreenshareInputId}
                        setIsScreenshareActive={setIsScreenshareActive}
                        addVideoAccordionRef={addVideoAccordionRef}
                    />
                    <PendingWhipInputs
                        roomId={roomId}
                        pendingInputs={pendingWhipInputs}
                        setPendingInputs={setPendingWhipInputs}
                        refreshState={handleRefreshState}
                        cameraPcRef={cameraPcRef}
                        cameraStreamRef={cameraStreamRef}
                        screensharePcRef={screensharePcRef}
                        screenshareStreamRef={screenshareStreamRef}
                        setActiveCameraInputId={setActiveCameraInputId}
                        setIsCameraActive={setIsCameraActive}
                        setActiveScreenshareInputId={setActiveScreenshareInputId}
                        setIsScreenshareActive={setIsScreenshareActive}
                    />
                    <StreamsSection
                        inputs={inputs}
                        inputWrappers={inputWrappers}
                        listVersion={listVersion}
                        showStreamsSpinner={showStreamsSpinner}
                        roomId={roomId}
                        refreshState={handleRefreshState}
                        availableShaders={availableShaders}
                        updateOrder={updateOrder}
                        openFxInputId={openFxInputId}
                        onToggleFx={handleToggleFx}
                        cameraPcRef={cameraPcRef}
                        cameraStreamRef={cameraStreamRef}
                        activeCameraInputId={activeCameraInputId}
                        activeScreenshareInputId={activeScreenshareInputId}
                        onWhipDisconnectedOrRemoved={handleWhipDisconnectedOrRemoved}
                    />
                    <QuickActionsSection
                        inputs={inputs}
                        roomId={roomId}
                        refreshState={handleRefreshState}
                    />
                    <ConfigurationSection
                        inputs={inputs}
                        layout={roomState.layout}
                        roomId={roomId}
                        refreshState={handleRefreshState}
                        pendingWhipInputs={pendingWhipInputs}
                        setPendingWhipInputs={setPendingWhipInputs}
                    />
                    <Accordion
                        title='Layouts'
                        defaultOpen
                        data-tour='layout-selector-container'>
                        <LayoutSelector
                            changeLayout={changeLayout}
                            activeLayoutId={roomState.layout}
                            connectedStreamsLength={roomState.inputs.length}
                        />
                    </Accordion>
                </>
            )}
        </motion.div>
    );
}
