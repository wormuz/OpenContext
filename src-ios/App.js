require('react-native-gesture-handler');
const React = require('react');
const { Pressable, Text, View, StyleSheet } = require('react-native');
const { Ionicons } = require('@expo/vector-icons');
const { GestureHandlerRootView } = require('react-native-gesture-handler');
const { NavigationContainer } = require('@react-navigation/native');
const { createBottomTabNavigator } = require('@react-navigation/bottom-tabs');
const { createNativeStackNavigator } = require('@react-navigation/native-stack');
const { SafeAreaProvider, useSafeAreaInsets } = require('react-native-safe-area-context');
const { I18nextProvider, useTranslation } = require('react-i18next');
const { initI18n } = require('./i18n');
const { initDb } = require('./db');
const IdeasScreen = require('./screens/IdeasScreen');
const SettingsScreen = require('./screens/SettingsScreen');
const { colors, typography } = require('./theme');

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function IdeasStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="IdeasHome" component={IdeasScreen} />
    </Stack.Navigator>
  );
}

function TabIcon({ name, color, focused }) {
  return (
    <Ionicons name={name} size={18} color={color} />
  );
}

function FloatingTabBar({ state, descriptors, navigation }) {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom - 12, 8);
  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.floatingBarWrap,
        { paddingBottom: bottomPad },
      ]}
    >
      <View style={styles.floatingBar}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const label =
            options.tabBarLabel !== undefined
              ? options.tabBarLabel
              : options.title !== undefined
              ? options.title
              : route.name;
          const isFocused = state.index === index;
          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };
          const onLongPress = () => {
            navigation.emit({
              type: 'tabLongPress',
              target: route.key,
            });
          };
          const color = isFocused ? colors.accent : colors.mutedInk;
          const icon = options.tabBarIcon
            ? options.tabBarIcon({ focused: isFocused, color, size: 18 })
            : null;
          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              onLongPress={onLongPress}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              accessibilityLabel={options.tabBarAccessibilityLabel}
              testID={options.tabBarTestID}
              style={({ pressed }) => [
                styles.segmentButton,
                isFocused && styles.segmentButtonActive,
                pressed && styles.segmentButtonPressed,
              ]}
            >
              <View style={styles.segmentContent}>
                {icon}
                <Text style={[styles.segmentLabel, isFocused && styles.segmentLabelActive]}>
                  {label}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function RootTabs() {
  const { t } = useTranslation();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBarPlaceholder,
        tabBarHideOnKeyboard: true,
      }}
      tabBar={(props) => <FloatingTabBar {...props} />}
    >
      <Tab.Screen
        name="Ideas"
        component={IdeasStack}
        options={{
          title: t('app.ideas'),
          tabBarIcon: (props) => <TabIcon {...props} name="bulb-outline" />,
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: t('app.settings'),
          tabBarIcon: (props) => <TabIcon {...props} name="settings-outline" />,
        }}
      />
    </Tab.Navigator>
  );
}

function LoadingScreen() {
  return (
    <View style={styles.loading}>
      <Text style={styles.loadingText}>OpenContext</Text>
    </View>
  );
}

function AppContainer() {
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    Promise.all([initI18n(), initDb()]).then(() => {
      if (active) {
        setReady(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  if (!ready) {
    return <LoadingScreen />;
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <NavigationContainer>
          <RootTabs />
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function App() {
  return (
    <I18nextProvider i18n={require('i18next')}>
      <AppContainer />
    </I18nextProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paper,
  },
  loadingText: {
    ...typography.title,
  },
  tabBarPlaceholder: {
    height: 0,
    backgroundColor: 'transparent',
    borderTopWidth: 0,
  },
  floatingBarWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 6,
    paddingHorizontal: 16,
    alignItems: 'center',
    zIndex: 20,
  },
  floatingBar: {
    width: '50%',
    maxWidth: 320,
    minWidth: 120,
    padding: 4,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 28,
    borderWidth: 0,
    shadowColor: colors.shadow,
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  segmentButton: {
    flex: 1,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 2,
  },
  segmentButtonActive: {
    backgroundColor: 'rgba(231, 111, 44, 0.14)',
  },
  segmentButtonPressed: {
    backgroundColor: 'rgba(231, 111, 44, 0.2)',
  },
  segmentContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  segmentLabel: {
    marginLeft: 6,
    fontFamily: typography.subtitle.fontFamily,
    fontSize: 12,
    letterSpacing: 0.2,
    color: colors.mutedInk,
  },
  segmentLabelActive: {
    color: colors.accent,
    fontWeight: '600',
  },
});

module.exports = App;
