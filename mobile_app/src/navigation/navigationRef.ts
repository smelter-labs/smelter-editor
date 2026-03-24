import { createNavigationContainerRef } from "@react-navigation/native";
import type { RootStackParamList } from "./navigationTypes";

export const navigationRef = createNavigationContainerRef<RootStackParamList>();
